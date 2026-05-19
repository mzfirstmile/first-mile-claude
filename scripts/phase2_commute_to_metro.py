#!/usr/bin/env python3
"""Phase 2 — Commute to Major Metro.

Computes a 0–10 score for every shortlist town based on great-circle
distance from the town's lat/lng to the nearest of ~60 top-50 US MSA
centers, converted to estimated drive time at ~1.5 min/mile (a rule
of thumb that approximates real-world traffic + local-road overhead).

Scoring band:
  ≤45 min   → 10   (target met)
  45-120 min → 10 − (mins − 45) / 7.5   (linear)
  ≥120 min   → 0

Writes:
  - market_research_scores  (one row per shortlist market, criterion_id =
    `4346bb4a-1373-4184-a900-851408d6857e`, updated_by='phase2_commute',
    value_numeric=score, value_text='~38mi → ~57min · nearest: New York',
    source='Haversine distance to top-50 MSA centers')
  - market_research_markets.miles_to_top50  (PATCH if currently NULL)

Then recomputes composite Score + Tier for every shortlist market by
weighted-mean of category means (same logic the front-end uses).

Run from sandbox or laptop:
    python3 scripts/phase2_commute_to_metro.py            # dry-run
    python3 scripts/phase2_commute_to_metro.py --commit   # writes
"""

import argparse
import json
import math
import os
import re
import sys
import urllib.request

FALLBACK_SUPA_URL = "https://qrtleqasnhbnruodlgpt.supabase.co"

# Top US metros — primary city center lat/lng. These act as the
# "nearest top-50 city" target. We carry ~60 entries so even rural
# pockets in the West/South get a sensible nearest match.
METROS = [
    ("New York, NY",              40.7128,  -74.0060),
    ("Los Angeles, CA",           34.0522, -118.2437),
    ("Chicago, IL",               41.8781,  -87.6298),
    ("Dallas, TX",                32.7767,  -96.7970),
    ("Houston, TX",               29.7604,  -95.3698),
    ("Washington, DC",            38.9072,  -77.0369),
    ("Miami, FL",                 25.7617,  -80.1918),
    ("Philadelphia, PA",          39.9526,  -75.1652),
    ("Atlanta, GA",               33.7490,  -84.3880),
    ("Boston, MA",                42.3601,  -71.0589),
    ("Phoenix, AZ",               33.4484, -112.0740),
    ("San Francisco, CA",         37.7749, -122.4194),
    ("San Jose, CA",              37.3382, -121.8863),
    ("Riverside, CA",             33.9533, -117.3961),
    ("Detroit, MI",               42.3314,  -83.0458),
    ("Seattle, WA",               47.6062, -122.3321),
    ("Minneapolis, MN",           44.9778,  -93.2650),
    ("Tampa, FL",                 27.9506,  -82.4572),
    ("San Diego, CA",             32.7157, -117.1611),
    ("Denver, CO",                39.7392, -104.9903),
    ("St. Louis, MO",             38.6270,  -90.1994),
    ("Baltimore, MD",             39.2904,  -76.6122),
    ("Charlotte, NC",             35.2271,  -80.8431),
    ("Orlando, FL",               28.5383,  -81.3792),
    ("San Antonio, TX",           29.4241,  -98.4936),
    ("Portland, OR",              45.5152, -122.6784),
    ("Sacramento, CA",            38.5816, -121.4944),
    ("Pittsburgh, PA",            40.4406,  -79.9959),
    ("Las Vegas, NV",             36.1699, -115.1398),
    ("Austin, TX",                30.2672,  -97.7431),
    ("Cincinnati, OH",            39.1031,  -84.5120),
    ("Kansas City, MO",           39.0997,  -94.5786),
    ("Columbus, OH",              39.9612,  -82.9988),
    ("Indianapolis, IN",          39.7684,  -86.1581),
    ("Cleveland, OH",             41.4993,  -81.6944),
    ("Nashville, TN",             36.1627,  -86.7816),
    ("Virginia Beach, VA",        36.8508,  -76.2859),
    ("Providence, RI",            41.8240,  -71.4128),
    ("Milwaukee, WI",             43.0389,  -87.9065),
    ("Jacksonville, FL",          30.3322,  -81.6557),
    ("Oklahoma City, OK",         35.4676,  -97.5164),
    ("Raleigh, NC",               35.7796,  -78.6382),
    ("Memphis, TN",               35.1495,  -90.0490),
    ("Richmond, VA",              37.5407,  -77.4360),
    ("New Orleans, LA",           29.9511,  -90.0715),
    ("Louisville, KY",            38.2527,  -85.7585),
    ("Salt Lake City, UT",        40.7608, -111.8910),
    ("Hartford, CT",              41.7658,  -72.6734),
    ("Buffalo, NY",               42.8864,  -78.8784),
    ("Birmingham, AL",            33.5186,  -86.8104),
    # extras — secondary cities that anchor parts of the country the
    # top-50 list otherwise leaves stranded
    ("Bridgeport, CT",            41.1865,  -73.1952),
    ("New Haven, CT",             41.3083,  -72.9279),
    ("Worcester, MA",             42.2626,  -71.8023),
    ("Albany, NY",                42.6526,  -73.7562),
    ("Rochester, NY",             43.1566,  -77.6088),
    ("Syracuse, NY",              43.0481,  -76.1474),
    ("Tucson, AZ",                32.2226, -110.9747),
    ("Albuquerque, NM",           35.0844, -106.6504),
    ("Fresno, CA",                36.7378, -119.7871),
    ("Tulsa, OK",                 36.1540,  -95.9928),
    ("Omaha, NE",                 41.2565,  -95.9345),
    ("Des Moines, IA",            41.5868,  -93.6250),
    ("Honolulu, HI",              21.3099, -157.8581),
    ("Anchorage, AK",             61.2181, -149.9003),
    ("Portland, ME",              43.6591,  -70.2568),
    ("Charleston, SC",            32.7765,  -79.9311),
    ("Savannah, GA",              32.0809,  -81.0912),
    ("Boise, ID",                 43.6150, -116.2023),
    ("Spokane, WA",               47.6588, -117.4260),
    ("Reno, NV",                  39.5296, -119.8138),
    ("El Paso, TX",               31.7619, -106.4850),
    ("Wichita, KS",               37.6872,  -97.3301),
    ("Lexington, KY",             38.0406,  -84.5037),
    ("Greensboro, NC",            36.0726,  -79.7920),
    ("Knoxville, TN",             35.9606,  -83.9207),
    ("Madison, WI",               43.0731,  -89.4012),
    ("Grand Rapids, MI",          42.9634,  -85.6681),
]


CRITERION_ID = "4346bb4a-1373-4184-a900-851408d6857e"  # Commute to Major Metro
TARGET_MIN = 45  # ≤45 min = full score
TARGET_MAX = 120  # ≥120 min = 0
MIN_PER_MILE = 1.5


def read_supabase_config():
    here = os.path.dirname(os.path.abspath(__file__))
    cfg = os.path.join(here, "..", "config.js")
    text = open(cfg).read() if os.path.exists(cfg) else ""
    url_m = re.search(r"SUPABASE_URL\s*=\s*['\"]([^'\"]+)['\"]", text)
    key_m = re.search(r"SUPABASE_KEY\s*=\s*['\"]([^'\"]+)['\"]", text)
    url = url_m.group(1) if url_m else os.environ.get("SUPABASE_URL", FALLBACK_SUPA_URL)
    key = key_m.group(1) if key_m else os.environ.get("SUPABASE_KEY", "")
    if not key:
        sys.exit("No SUPABASE_KEY — set window.SUPABASE_KEY in config.js or `export SUPABASE_KEY=…`")
    return url, key


def supa_request(method, base, path, body=None, supa_key="", prefer=None):
    headers = {
        "apikey": supa_key,
        "Authorization": f"Bearer {supa_key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as r:
        body_text = r.read().decode("utf-8")
        return body_text


def haversine_miles(lat1, lon1, lat2, lon2):
    R = 3958.7613  # earth radius in miles
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c


def nearest_metro(lat, lon):
    best_name = None
    best_miles = float("inf")
    for (name, mlat, mlon) in METROS:
        d = haversine_miles(lat, lon, mlat, mlon)
        if d < best_miles:
            best_miles = d
            best_name = name
    return best_name, best_miles


def score_minutes(mins):
    if mins <= TARGET_MIN:
        return 10.0
    if mins >= TARGET_MAX:
        return 0.0
    # linear 45→10, 120→0
    return round(10.0 - (mins - TARGET_MIN) * (10.0 / (TARGET_MAX - TARGET_MIN)), 2)


def fetch_shortlist(base, key):
    rows = []
    offset = 0
    while True:
        path = (
            "/rest/v1/market_research_markets?"
            "select=id,name,state,latitude,longitude,miles_to_top50,nearest_top50_city"
            "&phase=eq.shortlisted"
            "&latitude=not.is.null"
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
    ap.add_argument("--commit", action="store_true", help="actually write to Supabase")
    ap.add_argument("--limit", type=int, default=None, help="cap how many markets to process (testing)")
    args, _ = ap.parse_known_args()

    base, key = read_supabase_config()
    markets = fetch_shortlist(base, key)
    print(f"[shortlist] {len(markets)} towns with lat/lng")
    if args.limit:
        markets = markets[: args.limit]

    # Build score rows + market patches
    score_rows = []
    market_patches = []  # only when miles_to_top50 is null
    sample = []
    for m in markets:
        lat = float(m["latitude"])
        lon = float(m["longitude"])
        name, miles = nearest_metro(lat, lon)
        mins = miles * MIN_PER_MILE
        score = score_minutes(mins)
        vt = f"~{miles:.0f}mi → ~{mins:.0f}min · nearest: {name}"
        score_rows.append({
            "market_id": m["id"],
            "criterion_id": CRITERION_ID,
            "value_numeric": score,
            "value_text": vt,
            "source": f"Haversine to top-50 MSA ({name})",
            "updated_by": "phase2_commute",
        })
        if m.get("miles_to_top50") is None:
            market_patches.append((m["id"], round(miles, 1), name))
        if len(sample) < 8:
            sample.append((m["name"], m["state"], round(miles, 1), round(mins, 1), score, name))

    print("\nSample of computed scores:")
    print(f"  {'Town':28} {'St':3} {'Miles':>7} {'Mins':>6} {'Score':>6}  {'Nearest':20}")
    for s in sample:
        print(f"  {s[0][:28]:28} {s[1]:3} {s[2]:7} {s[3]:6} {s[4]:6}  {s[5][:20]:20}")

    band = {"10":0, "8-10":0, "6-8":0, "4-6":0, "2-4":0, "0-2":0}
    for r in score_rows:
        sc = r["value_numeric"]
        if sc >= 10: band["10"] += 1
        elif sc >= 8: band["8-10"] += 1
        elif sc >= 6: band["6-8"] += 1
        elif sc >= 4: band["4-6"] += 1
        elif sc >= 2: band["2-4"] += 1
        else: band["0-2"] += 1
    print("\nScore distribution:")
    for k in ["10","8-10","6-8","4-6","2-4","0-2"]:
        n = band[k]
        bar = "█" * (n // 10) if n else ""
        print(f"  {k:>5}  {n:4}  {bar}")

    print(f"\nWill PATCH {len(market_patches)} markets that have NULL miles_to_top50")
    if not args.commit:
        print("\n[dry-run] pass --commit to write.")
        return

    # 1) Wipe all prior scores for this criterion (Phase 2 takes over)
    print(f"\n[wipe] deleting existing scores for criterion {CRITERION_ID} ...")
    supa_request("DELETE", base, f"/rest/v1/market_research_scores?criterion_id=eq.{CRITERION_ID}", None, key, prefer="return=minimal")
    print("[wipe] done")

    # 2) Bulk-insert score rows (chunked)
    print(f"\n[insert] writing {len(score_rows)} score rows ...")
    CHUNK = 500
    for i in range(0, len(score_rows), CHUNK):
        chunk = score_rows[i:i+CHUNK]
        supa_request("POST", base, "/rest/v1/market_research_scores", chunk, key, prefer="return=minimal")
        print(f"  [{min(i+CHUNK, len(score_rows))}/{len(score_rows)}]")
    print("[insert] done")

    # 3) PATCH miles_to_top50 + nearest_top50_city where NULL
    print(f"\n[patch] updating miles_to_top50 on {len(market_patches)} markets ...")
    for n, (mid, miles, near) in enumerate(market_patches, 1):
        supa_request(
            "PATCH",
            base,
            f"/rest/v1/market_research_markets?id=eq.{mid}",
            {"miles_to_top50": miles, "nearest_top50_city": near},
            key,
            prefer="return=minimal",
        )
        if n % 100 == 0:
            print(f"  [{n}/{len(market_patches)}]")
    print("[patch] done")

    print("\n[OK] phase2 Commute to Major Metro committed.")
    print("Next: re-render the Market Research module — composite scores will refresh on the next render.")


if __name__ == "__main__":
    main()
