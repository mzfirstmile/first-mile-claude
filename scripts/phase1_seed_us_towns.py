#!/usr/bin/env python3
"""Phase 1 seed for the Market Research pipeline.

Pulls every US incorporated place / CDP from the Census ACS 5-year API,
filters down to the criteria-aligned shortlist, attaches lat/lng + nearest
top-50 city distance, and bulk-loads into Supabase market_research_markets.

Phase 1 filters (matches Morris's 5/18/26 criteria doc):
  - Population 5,000 – 75,000
  - Median Household Income ≥ $130,000
  - Straight-line distance to a top-50 US city ≤ 35 miles
    (proxy for the "45-min commute to major metro" criterion)

Pulled per-place fields:
  - B01003_001E — total population
  - B19013_001E — median household income
  - B25077_001E — median home value
  - Lat / Lng (centroid) from the Census Gazetteer place file
  - State FIPS / Place FIPS → GEOID

Each surviving row is written into market_research_markets with status='researching'
and phase='phase1'. Existing rows are wiped first (Morris asked for fresh start).

Run from a machine with internet access (Census API is NOT whitelisted in the
Cowork sandbox). Requirements: only stdlib + `requests` (pip install requests).

Usage:
  python3 scripts/phase1_seed_us_towns.py            # dry run (prints stats)
  python3 scripts/phase1_seed_us_towns.py --commit   # actually writes to DB
  python3 scripts/phase1_seed_us_towns.py --commit --state NY   # one state only

The Supabase anon key + URL are pulled from ../config.js automatically.
"""

import argparse
import csv
import io
import json
import math
import os
import re
import sys
import time
import urllib.request
import zipfile

# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────

POP_MIN = 5_000
POP_MAX = 75_000
HHI_MIN = 130_000
DISTANCE_TO_TOP50_MAX_MI = 35  # ≈ 45-min commute proxy

CENSUS_API = "https://api.census.gov/data/2022/acs/acs5"
GAZETTEER_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2022_Gazetteer/2022_gaz_place_national.zip"

# State FIPS → 2-letter postal
STATE_FIPS = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
    "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
    "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
    "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
    "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
    "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
    "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
    "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
    "54": "WV", "55": "WI", "56": "WY", "72": "PR",
}
POSTAL_TO_FIPS = {v: k for k, v in STATE_FIPS.items()}

# Top 50 US cities by population (rough 2023). lat/lng from Census / Wikipedia.
# Used as proxy "major metro" anchors for the 35-mi commute filter.
TOP50_CITIES = [
    ("New York, NY",       40.7128,  -74.0060),
    ("Los Angeles, CA",    34.0522, -118.2437),
    ("Chicago, IL",        41.8781,  -87.6298),
    ("Houston, TX",        29.7604,  -95.3698),
    ("Phoenix, AZ",        33.4484, -112.0740),
    ("Philadelphia, PA",   39.9526,  -75.1652),
    ("San Antonio, TX",    29.4241,  -98.4936),
    ("San Diego, CA",      32.7157, -117.1611),
    ("Dallas, TX",         32.7767,  -96.7970),
    ("Jacksonville, FL",   30.3322,  -81.6557),
    ("Austin, TX",         30.2672,  -97.7431),
    ("Fort Worth, TX",     32.7555,  -97.3308),
    ("San Jose, CA",       37.3382, -121.8863),
    ("Columbus, OH",       39.9612,  -82.9988),
    ("Charlotte, NC",      35.2271,  -80.8431),
    ("Indianapolis, IN",   39.7684,  -86.1581),
    ("San Francisco, CA",  37.7749, -122.4194),
    ("Seattle, WA",        47.6062, -122.3321),
    ("Denver, CO",         39.7392, -104.9903),
    ("Washington, DC",     38.9072,  -77.0369),
    ("Nashville, TN",      36.1627,  -86.7816),
    ("Oklahoma City, OK",  35.4676,  -97.5164),
    ("El Paso, TX",        31.7619, -106.4850),
    ("Boston, MA",         42.3601,  -71.0589),
    ("Portland, OR",       45.5152, -122.6784),
    ("Las Vegas, NV",      36.1699, -115.1398),
    ("Detroit, MI",        42.3314,  -83.0458),
    ("Memphis, TN",        35.1495,  -90.0490),
    ("Louisville, KY",     38.2527,  -85.7585),
    ("Baltimore, MD",      39.2904,  -76.6122),
    ("Milwaukee, WI",      43.0389,  -87.9065),
    ("Albuquerque, NM",    35.0844, -106.6504),
    ("Tucson, AZ",         32.2226, -110.9747),
    ("Fresno, CA",         36.7378, -119.7871),
    ("Mesa, AZ",           33.4152, -111.8315),
    ("Sacramento, CA",     38.5816, -121.4944),
    ("Atlanta, GA",        33.7490,  -84.3880),
    ("Kansas City, MO",    39.0997,  -94.5786),
    ("Colorado Springs, CO", 38.8339, -104.8214),
    ("Omaha, NE",          41.2565,  -95.9345),
    ("Raleigh, NC",        35.7796,  -78.6382),
    ("Miami, FL",          25.7617,  -80.1918),
    ("Long Beach, CA",     33.7701, -118.1937),
    ("Virginia Beach, VA", 36.8529,  -75.9780),
    ("Oakland, CA",        37.8044, -122.2712),
    ("Minneapolis, MN",    44.9778,  -93.2650),
    ("Tulsa, OK",          36.1540,  -95.9928),
    ("Tampa, FL",          27.9506,  -82.4572),
    ("Arlington, TX",      32.7357,  -97.1081),
    ("New Orleans, LA",    29.9511,  -90.0715),
]

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def haversine_mi(lat1, lon1, lat2, lon2):
    """Great-circle distance in miles."""
    R = 3958.7613
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * R * math.asin(math.sqrt(a))

def nearest_top50(lat, lon):
    """Returns (city_label, miles)."""
    best = (None, float("inf"))
    for label, clat, clon in TOP50_CITIES:
        d = haversine_mi(lat, lon, clat, clon)
        if d < best[1]:
            best = (label, d)
    return best

def http_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "FirstMileCap/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))

def http_bytes(url):
    req = urllib.request.Request(url, headers={"User-Agent": "FirstMileCap/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()

def read_supabase_config():
    """Pull Supabase URL + anon key out of ../config.js."""
    here = os.path.dirname(os.path.abspath(__file__))
    cfg = os.path.join(here, "..", "config.js")
    if not os.path.exists(cfg):
        sys.exit(f"Couldn't find {cfg}. Run from the project repo.")
    text = open(cfg).read()
    url = re.search(r"SUPABASE_URL\s*=\s*['\"]([^'\"]+)['\"]", text)
    key = re.search(r"SUPABASE_KEY\s*=\s*['\"]([^'\"]+)['\"]", text)
    if not url or not key:
        # Hardcoded fallback (project URL is in CLAUDE.md anyway)
        return ("https://qrtleqasnhbnruodlgpt.supabase.co",
                key.group(1) if key else "")
    return url.group(1), key.group(1)

# ─────────────────────────────────────────────────────────────────────────────
# Census pulls
# ─────────────────────────────────────────────────────────────────────────────

def fetch_acs_for_state(state_fips):
    """Returns list of dicts: NAME, pop, hhi, home_value, state, place (FIPS)."""
    fields = "NAME,B01003_001E,B19013_001E,B25077_001E"
    url = f"{CENSUS_API}?get={fields}&for=place:*&in=state:{state_fips}"
    raw = http_json(url)
    header, rows = raw[0], raw[1:]
    # Build dict per row
    idx = {h: i for i, h in enumerate(header)}
    out = []
    for r in rows:
        try:
            pop = int(r[idx["B01003_001E"]])
        except (ValueError, TypeError):
            continue
        try:
            hhi = int(r[idx["B19013_001E"]])
        except (ValueError, TypeError):
            hhi = None
        try:
            hv = int(r[idx["B25077_001E"]])
        except (ValueError, TypeError):
            hv = None
        out.append({
            "name": r[idx["NAME"]],
            "pop": pop,
            "hhi": hhi,
            "home_value": hv,
            "state_fips": r[idx["state"]],
            "place_fips": r[idx["place"]],
            "geoid": r[idx["state"]] + r[idx["place"]],
        })
    return out

def fetch_gazetteer_latlng():
    """Returns {geoid: (lat, lon, name)} for every US place."""
    print("[gazetteer] downloading...", file=sys.stderr)
    blob = http_bytes(GAZETTEER_URL)
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        # File inside: 2022_Gaz_place_national.txt (tab-delimited)
        name = [n for n in z.namelist() if "place_national" in n.lower()][0]
        text = z.read(name).decode("utf-8", errors="replace")
    out = {}
    # First line is header
    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    for row in reader:
        # The columns vary slightly between releases; normalize
        key = None
        for k in row:
            if k.strip() == "GEOID":
                key = k; break
        if key is None:
            # Pick the first numeric-looking column
            key = list(row.keys())[1]
        geoid = (row.get(key) or "").strip()
        try:
            lat = float(row.get("INTPTLAT", "").strip())
            lon = float(row.get("INTPTLONG", row.get("INTPTLONG ", "")).strip())
        except (ValueError, TypeError):
            continue
        # The "NAME" column for places
        place_name = None
        for k in row:
            if k.strip() == "NAME":
                place_name = row[k]; break
        out[geoid] = (lat, lon, place_name)
    print(f"[gazetteer] loaded {len(out)} places", file=sys.stderr)
    return out

# ─────────────────────────────────────────────────────────────────────────────
# Supabase writes
# ─────────────────────────────────────────────────────────────────────────────

def supabase_request(method, url, body=None, supa_url="", supa_key=""):
    headers = {
        "apikey": supa_key,
        "Authorization": f"Bearer {supa_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(supa_url + url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode("utf-8")

def wipe_markets(supa_url, supa_key):
    # Wipe scores first (FK), then markets
    print("[wipe] clearing market_research_scores + market_research_markets ...")
    supabase_request("DELETE", "/rest/v1/market_research_scores?id=neq.00000000-0000-0000-0000-000000000000",
                     supa_url=supa_url, supa_key=supa_key)
    supabase_request("DELETE", "/rest/v1/market_research_markets?id=neq.00000000-0000-0000-0000-000000000000",
                     supa_url=supa_url, supa_key=supa_key)

def insert_markets(rows, supa_url, supa_key, batch_size=200):
    n = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i+batch_size]
        supabase_request("POST", "/rest/v1/market_research_markets",
                         body=chunk, supa_url=supa_url, supa_key=supa_key)
        n += len(chunk)
        print(f"[insert] wrote {n}/{len(rows)}")
    return n

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="Actually write to Supabase")
    ap.add_argument("--state", help="Two-letter state code, optional (e.g. NY) to limit scope")
    args = ap.parse_args()

    supa_url, supa_key = read_supabase_config()

    # 1. Gazetteer (lat/lng for every place GEOID)
    geoid_to_latlng = fetch_gazetteer_latlng()

    # 2. ACS per-state
    if args.state:
        state_fips = POSTAL_TO_FIPS.get(args.state.upper())
        if not state_fips:
            sys.exit(f"Unknown state: {args.state}")
        target_fips = [state_fips]
    else:
        target_fips = list(STATE_FIPS.keys())

    all_places = []
    for sf in target_fips:
        sp = STATE_FIPS[sf]
        try:
            rows = fetch_acs_for_state(sf)
        except Exception as e:
            print(f"[{sp}] failed: {e}", file=sys.stderr)
            continue
        print(f"[{sp}] {len(rows)} places")
        all_places.extend(rows)
        time.sleep(0.3)

    # 3. Filter + enrich
    keep = []
    for p in all_places:
        if not (POP_MIN <= p["pop"] <= POP_MAX): continue
        if not p["hhi"] or p["hhi"] < HHI_MIN:    continue
        latlng = geoid_to_latlng.get(p["geoid"])
        if not latlng:
            continue
        lat, lon, _ = latlng
        city_label, dist = nearest_top50(lat, lon)
        if dist > DISTANCE_TO_TOP50_MAX_MI: continue

        # Clean the Census NAME (e.g. "Greenwich CDP, Connecticut" → "Greenwich, CT")
        raw = p["name"]
        # Drop the trailing ", State" full name (we already have postal code)
        bare = re.sub(r",\s*[A-Za-z ]+$", "", raw)
        # Strip the geography type suffix
        bare = re.sub(r"\s+(CDP|city|town|village|borough|township)$", "", bare, flags=re.I)
        postal = STATE_FIPS[p["state_fips"]]
        clean_name = f"{bare}, {postal}"

        keep.append({
            "name": clean_name,
            "state": postal,
            "population": p["pop"],
            "median_household_income": p["hhi"],
            "median_home_value": p["home_value"],
            "latitude": lat,
            "longitude": lon,
            "nearest_top50_city": city_label,
            "miles_to_top50": round(dist, 1),
            "census_place_geoid": p["geoid"],
            "status": "researching",
            "phase": "phase1",
        })

    keep.sort(key=lambda r: r["median_household_income"], reverse=True)

    # 4. Report
    print()
    print(f"=== Phase 1 results ===")
    print(f"Census rows scanned: {len(all_places):,}")
    print(f"Surviving Phase 1 filter (pop {POP_MIN:,}-{POP_MAX:,}, HHI ≥ ${HHI_MIN:,}, ≤{DISTANCE_TO_TOP50_MAX_MI}mi to top-50): {len(keep):,}")
    if keep:
        top10 = keep[:10]
        print("\nTop 10 by median HHI:")
        for r in top10:
            print(f"  {r['name']:40} pop={r['population']:>7,}  HHI=${r['median_household_income']:>7,}  {r['miles_to_top50']:>5.1f}mi → {r['nearest_top50_city']}")

    # 5. Write
    if args.commit:
        wipe_markets(supa_url, supa_key)
        insert_markets(keep, supa_url, supa_key)
        print(f"\n[OK] wrote {len(keep)} markets to Supabase")
    else:
        print("\n[dry-run] pass --commit to write to Supabase")

if __name__ == "__main__":
    main()
