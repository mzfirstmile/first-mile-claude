#!/usr/bin/env python3
"""
LEHD LODES → Office Demand criteria (market research module).

Replaces the ACS-survey-based Office Demand numbers with administrative payroll
counts from Census LEHD LODES (unemployment-insurance wage records, block level,
annual). Runs in GitHub Actions (.github/workflows/lodes-office-demand.yml) because
neither the Cowork sandbox nor Supabase edge functions can fetch lehd.ces.census.gov
/ handle 200MB of CSV.

Per state it downloads (LODES8, all gzip CSV):
  {st}_xwalk.csv.gz                       block → place (stplc) crosswalk
  {st}_wac_S000_JT00_{year}.csv.gz        jobs by WORKPLACE block, all workers
  {st}_wac_SE03_JT00_{year}.csv.gz        same, workers earning > $3,333/month
  {st}_wac_S000_JT00_{base_year}.csv.gz   for 5-yr growth
  {st}_rac_S000_JT00_{year}.csv.gz        workers by RESIDENCE block
Plus once: Census Gazetteer places file (land area).

Office-using sectors = CNS09 Information (51) + CNS10 Finance & Insurance (52)
  + CNS11 Real Estate (53) + CNS12 Professional/Scientific/Technical (54)
  + CNS13 Management of Companies (55) + CNS14 Administrative & Support (56).

Criteria written (updated_by='phase2_lodes', office view only, value_numeric NULL):
  Office-Using Jobs in Town            office jobs                      linear to target (5,000)
  Office Share of Local Jobs           office / all jobs %              linear to target (35%)
  Jobs-to-Resident-Workers Ratio       WAC C000 / RAC C000              linear to target (1.0)
  Office Job Growth (5-yr)             base_year → year office jobs %   -10%→0 · 0→5 · +15%→10
  High-Wage Office Jobs in Town        SE03 office jobs                 linear to target (3,000)
  Office Job Density                   office jobs / land sq mi         linear to target (1,000)
Prior 'phase2_office' (ACS) rows for the same (market, criterion) are replaced —
except Resident Remote-Work Share, which stays on ACS.

Usage:
  SUPABASE_URL=… SUPABASE_KEY=… python3 scripts/lodes_office_demand.py --states NJ,CT [--year 2022] [--base-year 2017] [--dry-run] [--recompute]
  --states all  → every state that has shortlisted markets
"""
import argparse, csv, gzip, io, json, os, sys, time, urllib.request, zipfile
from collections import defaultdict

LODES = "https://lehd.ces.census.gov/data/lodes/LODES8"
GAZ_URLS = [f"https://www2.census.gov/geo/docs/maps-data/data/gazetteer/{y}_Gazetteers/{y}_Gaz_place_national.zip" for y in (2024, 2023, 2022, 2021)]
OFFICE_COLS = ["CNS09", "CNS10", "CNS11", "CNS12", "CNS13", "CNS14"]
UPDATED_BY = "phase2_lodes"
REPLACES = "phase2_office"
CRIT = {
    "jobs": "Office-Using Jobs in Town",
    "share": "Office Share of Local Jobs",
    "ratio": "Jobs-to-Resident-Workers Ratio",
    "growth": "Office Job Growth (5-yr)",
    "hiwage": "High-Wage Office Jobs in Town",
    "density": "Office Job Density",
}

SB = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_KEY", "")
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}


def sql(q):
    req = urllib.request.Request(f"{SB}/rest/v1/rpc/exec_sql", data=json.dumps({"query": q}).encode(), headers=H)
    with urllib.request.urlopen(req, timeout=120) as r:
        out = json.load(r)
    if isinstance(out, dict) and out.get("error"):
        raise RuntimeError(out)
    return out


def rest(path):
    req = urllib.request.Request(f"{SB}/rest/v1/{path}", headers=H)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def fetch(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=300) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))


def gz_rows(blob):
    return csv.DictReader(io.TextIOWrapper(gzip.GzipFile(fileobj=io.BytesIO(blob)), encoding="utf-8"))


def lodes_file(st, kind, seg, year):
    """kind: wac|rac. Falls back one year either side when a state lacks that year."""
    for y in (year, year - 1, year + 1):
        blob = fetch(f"{LODES}/{st}/{kind}/{st}_{kind}_{seg}_JT00_{y}.csv.gz")
        if blob:
            return blob, y
    return None, None


def load_gazetteer():
    """Place land area (sq mi) by 7-digit GEOID. Returns {} (density skipped) if unavailable."""
    blob = None
    for url in GAZ_URLS:
        try:
            b = fetch(url)
        except Exception as e:
            print(f"  gazetteer {url.split('/')[-1]}: {e}", flush=True); continue
        if b and b[:2] == b"PK":
            blob = b; print(f"  gazetteer: {url.split('/')[-1]}", flush=True); break
        print(f"  gazetteer {url.split('/')[-1]}: {'404' if b is None else 'not a zip (%d bytes)' % len(b)}", flush=True)
    if not blob:
        print("  WARNING: no Gazetteer file — Office Job Density will be skipped", flush=True)
        return {}
    area = {}
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        name = [n for n in z.namelist() if n.lower().endswith(".txt")][0]
        for row in csv.DictReader(io.TextIOWrapper(z.open(name), encoding="latin-1"), delimiter="\t"):
            row = {k.strip(): (v.strip() if isinstance(v, str) else v) for k, v in row.items()}
            try:
                area[row["GEOID"]] = float(row["ALAND_SQMI"])
            except (KeyError, ValueError):
                pass
    return area


def lin(v, tgt):
    if v is None or tgt is None or tgt <= 0 or v < 0:
        return None
    return round(min(10.0, v / tgt * 10), 1)


def growth_score(pct):
    # −10% → 0, 0% → 5 (hold your own), +15% → 10
    if pct is None:
        return None
    return round(max(0.0, min(10.0, (pct + 10) / 25 * 10)), 1)


def agg_state(st, geoids, year, base_year):
    """Return {geoid7: dict(jobs, office, hi_office, base_office, res_workers, years)}"""
    st = st.lower()
    want = set(geoids)
    xw = fetch(f"{LODES}/{st}/{st}_xwalk.csv.gz")
    if not xw:
        print(f"  {st.upper()}: no crosswalk", flush=True)
        return {}
    blk2plc = {}
    for row in gz_rows(xw):
        plc = row.get("stplc") or ""
        if plc in want:
            blk2plc[row["tabblk2020"]] = plc
    print(f"  {st.upper()}: {len(blk2plc):,} blocks in {len(want)} target places", flush=True)

    out = defaultdict(lambda: {"jobs": 0, "office": 0, "hi_office": 0, "base_office": None, "res_workers": 0})
    years = {}

    def run_wac(seg, y, field):
        blob, yy = lodes_file(st, "wac", seg, y)
        if not blob:
            print(f"  {st.upper()}: wac {seg} {y} missing", flush=True)
            return
        years[f"wac_{seg}_{y}"] = yy
        for row in gz_rows(blob):
            plc = blk2plc.get(row["w_geocode"])
            if not plc:
                continue
            off = sum(int(row[c]) for c in OFFICE_COLS)
            rec = out[plc]
            if field == "cur":
                rec["jobs"] += int(row["C000"]); rec["office"] += off
            elif field == "hi":
                rec["hi_office"] += off
            elif field == "base":
                rec["base_office"] = (rec["base_office"] or 0) + off

    run_wac("S000", year, "cur")
    run_wac("SE03", year, "hi")
    run_wac("S000", base_year, "base")
    blob, yy = lodes_file(st, "rac", "S000", year)
    if blob:
        years[f"rac_{year}"] = yy
        for row in gz_rows(blob):
            plc = blk2plc.get(row["h_geocode"])
            if plc:
                out[plc]["res_workers"] += int(row["C000"])
    for rec in out.values():
        rec["years"] = years
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--states", required=True, help="comma list or 'all'")
    ap.add_argument("--year", type=int, default=2022)
    ap.add_argument("--base-year", type=int, default=2017)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--recompute", action="store_true", help="run composite recompute + re-rank at the end")
    a = ap.parse_args()
    if not SB or not KEY:
        sys.exit("SUPABASE_URL / SUPABASE_KEY env required")

    # criteria ids + office targets
    crits = {c["name"]: c for c in rest("market_research_criteria?select=id,name,target_min_office&category=eq.office_demand")}
    missing = [n for n in CRIT.values() if n not in crits]
    if missing:
        sys.exit(f"criteria missing: {missing}")

    # shortlisted markets
    mk = []
    off = 0
    while True:
        page = rest(f"market_research_markets?select=id,name,state,census_place_geoid&phase=eq.shortlisted&census_place_geoid=not.is.null&order=id&offset={off}&limit=1000")
        mk += page
        if len(page) < 1000:
            break
        off += 1000
    by_state = defaultdict(list)
    for m in mk:
        by_state[m["state"]].append(m)
    states = sorted(by_state) if a.states.lower() == "all" else [s.strip().upper() for s in a.states.split(",")]
    print(f"{len(mk)} shortlisted markets; running {len(states)} states: {' '.join(states)}", flush=True)

    print("Loading Gazetteer land areas…", flush=True)
    area = load_gazetteer()
    print(f"  {len(area):,} places with land area", flush=True)

    t = {k: crits[v]["target_min_office"] for k, v in CRIT.items()}
    rows = []       # (market_id, criterion_id, score, raw, text, source)
    summary = []
    for st in states:
        ms = by_state.get(st, [])
        if not ms:
            print(f"  {st}: no shortlisted markets", flush=True); continue
        geo2m = {m["census_place_geoid"]: m for m in ms}
        t0 = time.time()
        data = agg_state(st, list(geo2m), a.year, a.base_year)
        n = 0
        for geoid, m in geo2m.items():
            d = data.get(geoid)
            if not d or d["jobs"] == 0:
                continue
            n += 1
            yrs = d["years"]
            y_cur = yrs.get(f"wac_S000_{a.year}", a.year)
            y_base = yrs.get(f"wac_S000_{a.base_year}", a.base_year)
            src = f"https://lehd.ces.census.gov/data/lodes/LODES8/{st.lower()}/ (LODES {y_cur} WAC, NAICS 51-56, block→place via xwalk)"
            office, jobs = d["office"], d["jobs"]
            share = office / jobs * 100 if jobs else None
            rows.append((m["id"], crits[CRIT["jobs"]]["id"], lin(office, t["jobs"]), office,
                         f"{office:,} office jobs of {jobs:,} in town (LODES {y_cur})", src))
            rows.append((m["id"], crits[CRIT["share"]]["id"], lin(share, t["share"]), share,
                         f"{share:.1f}% of in-town payroll jobs are office-using", src))
            if d["res_workers"] > 0:
                ratio = jobs / d["res_workers"]
                rows.append((m["id"], crits[CRIT["ratio"]]["id"], lin(ratio, t["ratio"]), ratio,
                             f"{ratio:.2f}× ({jobs:,} jobs in town ÷ {d['res_workers']:,} employed residents)", src + " + RAC"))
            if d["base_office"] and d["base_office"] >= 100:
                g = (office - d["base_office"]) / d["base_office"] * 100
                rows.append((m["id"], crits[CRIT["growth"]]["id"], growth_score(g), g,
                             f"{g:+.1f}% ({d['base_office']:,} → {office:,} office jobs, LODES {y_base}→{y_cur})", src))
            rows.append((m["id"], crits[CRIT["hiwage"]]["id"], lin(d["hi_office"], t["hiwage"]), d["hi_office"],
                         f"{d['hi_office']:,} office jobs paying >$3,333/mo ({(d['hi_office'] / office * 100 if office else 0):.0f}% of office jobs)", src + " (SE03)"))
            sqmi = area.get(geoid)
            if sqmi and sqmi > 0:
                dens = office / sqmi
                rows.append((m["id"], crits[CRIT["density"]]["id"], lin(dens, t["density"]), dens,
                             f"{dens:,.0f} office jobs / sq mi ({office:,} jobs over {sqmi:.1f} sq mi)", src + " ÷ Gazetteer ALAND"))
        summary.append((st, len(ms), n, round(time.time() - t0)))
        print(f"  {st}: {n}/{len(ms)} markets scored in {round(time.time() - t0)}s", flush=True)

    print(f"\n{len(rows)} score rows for {len({r[0] for r in rows})} markets", flush=True)
    if a.dry_run:
        for r in rows[:24]:
            print("  ", r[2], "|", r[4])
        return

    # write: replace prior LODES rows and the ACS rows they supersede, per (market, criterion)
    mids = sorted({r[0] for r in rows})
    cids = [crits[v]["id"] for v in CRIT.values()]
    for i in range(0, len(mids), 300):
        chunk = ",".join(f"'{x}'" for x in mids[i:i + 300])
        sql(f"DELETE FROM market_research_scores WHERE market_id IN ({chunk}) AND criterion_id IN ({','.join(chr(39) + c + chr(39) for c in cids)}) AND updated_by IN ('{UPDATED_BY}','{REPLACES}')")

    def esc(s):
        return str(s).replace("'", "''")
    for i in range(0, len(rows), 200):
        vals = ",".join(
            f"('{mid}','{cid}',NULL,{'NULL' if sc is None else sc},{'NULL' if raw is None else round(raw, 3)},'{esc(txt)}','{esc(src)}','{UPDATED_BY}',now())"
            for mid, cid, sc, raw, txt, src in rows[i:i + 200])
        sql(f"INSERT INTO market_research_scores (market_id, criterion_id, value_numeric, value_numeric_office, raw_value, value_text, source, updated_by, updated_at) VALUES {vals}")
    print("written.", flush=True)

    if a.recompute:
        print("recomputing composites + ranks…", flush=True)
        sql("""WITH cat_means AS (SELECT s.market_id, c.category_id, AVG(CASE WHEN c.is_active_residential IS NOT FALSE THEN s.value_numeric ELSE NULL END) AS mean_res, AVG(CASE WHEN c.is_active_office IS NOT FALSE THEN s.value_numeric_office ELSE NULL END) AS mean_off FROM market_research_scores s JOIN market_research_criteria c ON c.id = s.criterion_id WHERE c.category_id IS NOT NULL GROUP BY s.market_id, c.category_id), composites AS (SELECT cm.market_id, SUM(cm.mean_res * cat.weight) / NULLIF(SUM(CASE WHEN cm.mean_res IS NOT NULL THEN cat.weight ELSE 0 END), 0) AS comp_res, SUM(cm.mean_off * cat.weight_office) / NULLIF(SUM(CASE WHEN cm.mean_off IS NOT NULL THEN cat.weight_office ELSE 0 END), 0) AS comp_off FROM cat_means cm JOIN market_research_categories cat ON cat.id = cm.category_id GROUP BY cm.market_id) UPDATE market_research_markets m SET score = ROUND(c.comp_res::numeric, 1), tier = CASE WHEN ROUND(c.comp_res::numeric, 1) >= 8.5 THEN 1 WHEN ROUND(c.comp_res::numeric, 1) >= 7.0 THEN 2 WHEN ROUND(c.comp_res::numeric, 1) >= 4.0 THEN 3 WHEN c.comp_res IS NOT NULL THEN 4 ELSE m.tier END, office_score = ROUND(c.comp_off::numeric, 1), office_tier = CASE WHEN ROUND(c.comp_off::numeric, 1) >= 8.5 THEN 1 WHEN ROUND(c.comp_off::numeric, 1) >= 7.0 THEN 2 WHEN ROUND(c.comp_off::numeric, 1) >= 4.0 THEN 3 WHEN c.comp_off IS NOT NULL THEN 4 ELSE m.office_tier END, updated_at = now() FROM composites c WHERE m.id = c.market_id""")
        sql("WITH rr AS (SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC NULLS LAST, median_household_income DESC NULLS LAST, name ASC) AS r FROM market_research_markets WHERE score IS NOT NULL) UPDATE market_research_markets m SET rank_residential = rr.r FROM rr WHERE m.id = rr.id")
        sql("WITH ro AS (SELECT id, ROW_NUMBER() OVER (ORDER BY office_score DESC NULLS LAST, median_household_income DESC NULLS LAST, name ASC) AS r FROM market_research_markets WHERE office_score IS NOT NULL) UPDATE market_research_markets m SET rank_office = ro.r FROM ro WHERE m.id = ro.id")
        print("done.", flush=True)


if __name__ == "__main__":
    main()
