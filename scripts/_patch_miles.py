#!/usr/bin/env python3
"""Finish populating miles_to_top50 + nearest_top50_city for the remaining
shortlist markets. Uses the same metro centers as phase2_commute_to_metro.py."""
import sys, os
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
from phase2_commute_to_metro import (
    read_supabase_config, supa_request, nearest_metro
)
import json, time

base, key = read_supabase_config()

def fetch_null():
    rows = []
    offset = 0
    while True:
        path = (
            "/rest/v1/market_research_markets?"
            "select=id,latitude,longitude"
            "&phase=eq.shortlisted&miles_to_top50=is.null"
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

markets = fetch_null()
print(f"{len(markets)} markets need patching")
t0 = time.time()
for n, m in enumerate(markets, 1):
    lat = float(m["latitude"])
    lon = float(m["longitude"])
    name, miles = nearest_metro(lat, lon)
    supa_request(
        "PATCH",
        base,
        f"/rest/v1/market_research_markets?id=eq.{m['id']}",
        {"miles_to_top50": round(miles, 1), "nearest_top50_city": name},
        key,
        prefer="return=minimal",
    )
    if n % 50 == 0:
        print(f"  [{n}/{len(markets)}] {time.time()-t0:.1f}s")
print(f"done in {time.time()-t0:.1f}s")
