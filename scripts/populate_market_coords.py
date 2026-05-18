#!/usr/bin/env python3
"""Populate latitude/longitude on market_research_markets from the Census Gazetteer.

Every market row carries a `census_place_geoid` (set when Phase 1 seeded the
universe). The Census 2022 Gazetteer file is a single ~5MB TSV with the
interior-point lat/lng for every place keyed by GEOID. We download it once,
parse it, and UPDATE every market whose latitude is currently NULL.

Run from a machine with internet access (sandbox can't fetch
www2.census.gov; runs fine on a Mac):

    cd ~/Desktop/first-mile-claude
    python3 scripts/populate_market_coords.py            # dry-run
    python3 scripts/populate_market_coords.py --commit   # writes to Supabase

Dependencies: stdlib only.
"""

import argparse
import csv
import io
import json
import os
import re
import sys
import urllib.request
import zipfile

GAZETTEER_URLS = [
    # Census file naming changed across years + uses capital "Gaz" in 2022+.
    # Try recent first, fall back to older.
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip",
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_place_national.zip",
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2022_Gazetteer/2022_Gaz_place_national.zip",
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2021_Gazetteer/2021_Gaz_place_national.zip",
]


FALLBACK_SUPA_URL = "https://qrtleqasnhbnruodlgpt.supabase.co"


def read_supabase_config():
    """Pull the URL + anon key. URL falls back to the known project URL
    (public anyway); KEY can come from config.js OR a SUPABASE_KEY env var."""
    here = os.path.dirname(os.path.abspath(__file__))
    cfg = os.path.join(here, "..", "config.js")
    text = open(cfg).read() if os.path.exists(cfg) else ""
    url_m = re.search(r"SUPABASE_URL\s*=\s*['\"]([^'\"]+)['\"]", text)
    key_m = re.search(r"SUPABASE_KEY\s*=\s*['\"]([^'\"]+)['\"]", text)
    url = url_m.group(1) if url_m else FALLBACK_SUPA_URL
    key = key_m.group(1) if key_m else os.environ.get("SUPABASE_KEY", "")
    if not key:
        sys.exit("No SUPABASE_KEY — set window.SUPABASE_KEY in config.js or `export SUPABASE_KEY=…`")
    return url, key


def http_bytes(url):
    req = urllib.request.Request(url, headers={"User-Agent": "FirstMileCap/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def supa_request(method, base, path, body=None, supa_key=""):
    headers = {
        "apikey": supa_key,
        "Authorization": f"Bearer {supa_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode("utf-8")


def fetch_gazetteer():
    blob = None
    last_err = None
    for url in GAZETTEER_URLS:
        try:
            print(f"[gazetteer] trying {url.split('/')[-1]} ...", file=sys.stderr)
            blob = http_bytes(url)
            print(f"[gazetteer] got {len(blob)//1024} KB", file=sys.stderr)
            break
        except Exception as e:
            last_err = e
            continue
    if not blob:
        sys.exit(f"[gazetteer] every URL failed: {last_err}")
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        name = [n for n in z.namelist() if "place_national" in n.lower()][0]
        text = z.read(name).decode("utf-8", errors="replace")
    geoid_to_coords = {}
    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    for row in reader:
        # Census ships with stray whitespace in some column names
        keys = {k.strip(): k for k in row.keys()}
        geoid = (row.get(keys.get("GEOID", "GEOID")) or "").strip()
        try:
            lat_raw = (row.get(keys.get("INTPTLAT", "INTPTLAT")) or "").strip()
            lon_raw = (row.get(keys.get("INTPTLONG", "INTPTLONG")) or "").strip()
            lat = float(lat_raw)
            lon = float(lon_raw)
        except (ValueError, TypeError, AttributeError):
            continue
        if geoid:
            geoid_to_coords[geoid] = (lat, lon)
    print(f"[gazetteer] {len(geoid_to_coords)} GEOIDs with coords", file=sys.stderr)
    return geoid_to_coords


def fetch_markets_missing_coords(base, key):
    rows = []
    offset = 0
    while True:
        path = (
            "/rest/v1/market_research_markets?"
            "select=id,name,state,census_place_geoid"
            "&latitude=is.null"
            f"&offset={offset}&limit=1000"
        )
        chunk = json.loads(supa_request("GET", base, path, None, key))
        if not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < 1000:
            break
        offset += 1000
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--limit", type=int, default=None, help="Cap how many rows to update (testing)")
    # parse_known_args so stray shell-comment fragments like '# dry-run' don't blow up
    args, _ignore = ap.parse_known_args()

    base, key = read_supabase_config()

    coords = fetch_gazetteer()
    markets = fetch_markets_missing_coords(base, key)
    print(f"[markets] {len(markets)} rows missing latitude")
    if args.limit:
        markets = markets[: args.limit]

    matched = 0
    unmatched_geoid = 0
    no_geoid = 0
    for m in markets:
        g = m.get("census_place_geoid")
        if not g:
            no_geoid += 1
            continue
        if g not in coords:
            unmatched_geoid += 1
            continue
        matched += 1
    print(f"\nMatching summary:")
    print(f"  matched         {matched}")
    print(f"  geoid not in gazetteer  {unmatched_geoid}")
    print(f"  no geoid on row {no_geoid}")

    if not args.commit:
        print("\n[dry-run] pass --commit to write the updates.")
        return

    updated = 0
    for m in markets:
        g = m.get("census_place_geoid")
        if not g or g not in coords:
            continue
        lat, lon = coords[g]
        supa_request(
            "PATCH",
            base,
            f"/rest/v1/market_research_markets?id=eq.{m['id']}",
            {"latitude": lat, "longitude": lon},
            key,
        )
        updated += 1
        if updated % 250 == 0:
            print(f"  [{updated}/{matched}] {m.get('name')}")
    print(f"\n[OK] {updated} markets updated.")


if __name__ == "__main__":
    main()
