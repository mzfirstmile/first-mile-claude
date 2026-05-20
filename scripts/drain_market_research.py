#!/usr/bin/env python3
"""Drain pending Market Research scoring tasks from your laptop.

Two jobs:
  1. Highway proximity (OSM Overpass) — FREE, no API key. Scores
     'Proximity to Major Highway' for all T1-T3 markets that don't have it.
  2. Phase 3 expanded (Claude API) — COSTS ~$0.04/market. Scores the 3 new
     Education criteria + Highway for T2 markets missing Phase 3.

Why this runs on your laptop instead of the in-chat sandbox:
  - The Cowork sandbox has a 45-second bash timeout per command.
  - Supabase edge functions cancel mid-flight when the HTTP client closes
    its socket — so fire-and-forget doesn't work.
  - A normal Python process with no timeout sits patiently until each
    edge-function call returns its full response.

Usage:
  python3 scripts/drain_market_research.py highway       # job 1 only
  python3 scripts/drain_market_research.py phase3        # job 2 only
  python3 scripts/drain_market_research.py both          # both, highway first
  python3 scripts/drain_market_research.py recompute     # composites + ranks only
"""

import json
import os
import re
import sys
import time
import urllib.request

# ──────────────────────────────────────────────────────────────────────────
# Config — pulled from ../config.js
# ──────────────────────────────────────────────────────────────────────────

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(HERE, "..", "config.js")
TEXT = open(CFG).read() if os.path.exists(CFG) else ""
URL = re.search(r"SUPABASE_URL\s*=\s*['\"]([^'\"]+)['\"]", TEXT)
KEY = re.search(r"SUPABASE_KEY\s*=\s*['\"]([^'\"]+)['\"]", TEXT)
if not URL or not KEY:
    sys.exit("Could not find SUPABASE_URL / SUPABASE_KEY in ../config.js")
SUPA_URL = URL.group(1)
SUPA_KEY = KEY.group(1)

HEADERS = {
    "apikey": SUPA_KEY,
    "Authorization": f"Bearer {SUPA_KEY}",
    "Content-Type": "application/json",
}


def post(path: str, body: dict, timeout: int = 130) -> dict:
    req = urllib.request.Request(
        SUPA_URL + path, method="POST",
        headers=HEADERS, data=json.dumps(body).encode("utf-8"),
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def sql(q: str) -> dict:
    return post("/rest/v1/rpc/exec_sql", {"query": q})


# ──────────────────────────────────────────────────────────────────────────
# Job 1 — Highway (FREE)
# ──────────────────────────────────────────────────────────────────────────

def drain_highway():
    print("\n=== Highway Proximity scoring (OSM Overpass) ===")
    # Find T1-T3 markets that don't have a Highway score yet
    rows = sql(
        "SELECT m.id FROM market_research_markets m "
        "WHERE m.tier IN (1,2,3) AND NOT EXISTS ("
        "  SELECT 1 FROM market_research_scores s "
        "  JOIN market_research_criteria c ON c.id = s.criterion_id "
        "  WHERE s.market_id = m.id AND c.name = 'Proximity to Major Highway') "
        "ORDER BY m.tier ASC, m.score DESC NULLS LAST "
        "LIMIT 5000"
    )
    ids = [r["id"] for r in rows] if isinstance(rows, list) else []
    print(f"  Unscored T1-T3 markets: {len(ids)}")
    if not ids:
        print("  Nothing to do.")
        return

    BATCH = 20
    CONC = 5
    for i in range(0, len(ids), BATCH):
        batch = ids[i:i + BATCH]
        t0 = time.time()
        try:
            r = post(
                "/functions/v1/market-research-highway",
                {"market_ids": batch, "batch_size": len(batch), "concurrency": CONC},
                timeout=150,
            )
            dur = round(time.time() - t0, 1)
            print(f"  batch {i // BATCH + 1:>3}: {r.get('processed', 0)} markets · "
                  f"{r.get('error_count', 0)} errors · {dur}s")
        except Exception as e:
            print(f"  batch {i // BATCH + 1:>3}: ERR — {str(e)[:120]}")
        time.sleep(1.0)  # polite spacing for Overpass

    print("✓ Highway drain complete")


# ──────────────────────────────────────────────────────────────────────────
# Job 2 — Phase 3 (PAID — uses Anthropic credits)
# ──────────────────────────────────────────────────────────────────────────

def drain_phase3():
    print("\n=== Phase 3 expanded (Claude) — T2 backlog ===")
    rows = sql(
        "SELECT id FROM market_research_markets "
        "WHERE tier = 2 AND phase3_ran_at IS NULL "
        "ORDER BY score DESC NULLS LAST "
        "LIMIT 5000"
    )
    ids = [r["id"] for r in rows] if isinstance(rows, list) else []
    print(f"  T2 markets needing Phase 3: {len(ids)}")
    if not ids:
        print("  Nothing to do.")
        return
    est = len(ids) * 0.04
    print(f"  Estimated cost: ~${est:.2f}")
    if input("  Proceed? (y/N) ").strip().lower() != "y":
        print("  Skipped.")
        return

    BATCH = 25
    CONC = 8
    for i in range(0, len(ids), BATCH):
        batch = ids[i:i + BATCH]
        t0 = time.time()
        try:
            r = post(
                "/functions/v1/market-research-phase3",
                {"market_ids": batch, "concurrency": CONC, "max_cost_usd": 5},
                timeout=150,
            )
            dur = round(time.time() - t0, 1)
            err = len(r.get("errors", []))
            print(f"  batch {i // BATCH + 1:>3}: {r.get('processed', 0)} markets · "
                  f"${r.get('cost_usd', 0):.3f} · {err} errors · {dur}s")
        except Exception as e:
            print(f"  batch {i // BATCH + 1:>3}: ERR — {str(e)[:120]}")

    print("✓ Phase 3 drain complete")


# ──────────────────────────────────────────────────────────────────────────
# Final recompute — composites + ranks
# ──────────────────────────────────────────────────────────────────────────

def recompute():
    print("\n=== Recompute composites + ranks ===")

    # 1. Per-criterion re-score (uses target_min/max per view + raw_value)
    sql_re = """UPDATE market_research_scores s
      SET
        value_numeric = CASE
          WHEN c.name = 'Town Population' AND s.raw_value > 0 THEN
            CASE WHEN s.raw_value < 5000 OR s.raw_value > 75000 THEN 0
                 WHEN s.raw_value <= 25000 THEN ROUND(LEAST(10, (s.raw_value - 5000)/2000.0)::numeric, 1)
                 WHEN s.raw_value <= 50000 THEN 10
                 ELSE ROUND(GREATEST(0, (75000 - s.raw_value)/2500.0)::numeric, 1) END
          WHEN c.name = 'Commute to Major Metro' AND s.raw_value > 0 THEN
            CASE WHEN s.raw_value <= 45 THEN 10 WHEN s.raw_value >= 120 THEN 0
                 ELSE ROUND((10 - (s.raw_value - 45)/7.5)::numeric, 1) END
          WHEN c.target_min IS NOT NULL AND c.target_max IS NULL AND s.raw_value > 0 AND c.target_min > 0 THEN
            LEAST(10, ROUND((s.raw_value / c.target_min * 10)::numeric, 1))
          ELSE s.value_numeric
        END,
        value_numeric_office = CASE
          WHEN c.name = 'Town Population' AND s.raw_value > 0 THEN
            CASE WHEN s.raw_value < 5000 OR s.raw_value > 75000 THEN 0
                 WHEN s.raw_value <= 25000 THEN ROUND(LEAST(10, (s.raw_value - 5000)/2000.0)::numeric, 1)
                 WHEN s.raw_value <= 50000 THEN 10
                 ELSE ROUND(GREATEST(0, (75000 - s.raw_value)/2500.0)::numeric, 1) END
          WHEN c.name = 'Commute to Major Metro' AND s.raw_value > 0 THEN
            CASE WHEN s.raw_value <= 45 THEN 10 WHEN s.raw_value >= 120 THEN 0
                 ELSE ROUND((10 - (s.raw_value - 45)/7.5)::numeric, 1) END
          WHEN c.target_min_office IS NOT NULL AND c.target_max_office IS NULL AND s.raw_value > 0 AND c.target_min_office > 0 THEN
            LEAST(10, ROUND((s.raw_value / c.target_min_office * 10)::numeric, 1))
          ELSE s.value_numeric_office
        END
      FROM market_research_criteria c
      WHERE s.criterion_id = c.id AND s.updated_by IN ('phase2_auto', 'phase2_commute')"""
    sql(sql_re)
    print("  ✓ Per-criterion re-score done")

    # 2. Dual composite
    sql_comp = """WITH cat_means AS (
      SELECT s.market_id, c.category_id,
        AVG(CASE WHEN c.is_active_residential IS NOT FALSE THEN s.value_numeric ELSE NULL END) AS mean_res,
        AVG(CASE WHEN c.is_active_office      IS NOT FALSE THEN s.value_numeric_office ELSE NULL END) AS mean_off
      FROM market_research_scores s JOIN market_research_criteria c ON c.id = s.criterion_id
      WHERE c.category_id IS NOT NULL GROUP BY s.market_id, c.category_id
    ),
    composites AS (
      SELECT cm.market_id,
        SUM(cm.mean_res * cat.weight) / NULLIF(SUM(CASE WHEN cm.mean_res IS NOT NULL THEN cat.weight ELSE 0 END), 0) AS comp_res,
        SUM(cm.mean_off * cat.weight_office) / NULLIF(SUM(CASE WHEN cm.mean_off IS NOT NULL THEN cat.weight_office ELSE 0 END), 0) AS comp_off
      FROM cat_means cm JOIN market_research_categories cat ON cat.id = cm.category_id
      GROUP BY cm.market_id
    )
    UPDATE market_research_markets m SET
      score = ROUND(c.comp_res::numeric, 1),
      tier  = CASE WHEN c.comp_res >= 8.5 THEN 1 WHEN c.comp_res >= 7.0 THEN 2 WHEN c.comp_res >= 4.0 THEN 3 WHEN c.comp_res IS NOT NULL THEN 4 ELSE m.tier END,
      office_score = ROUND(c.comp_off::numeric, 1),
      office_tier  = CASE WHEN c.comp_off >= 8.5 THEN 1 WHEN c.comp_off >= 7.0 THEN 2 WHEN c.comp_off >= 4.0 THEN 3 WHEN c.comp_off IS NOT NULL THEN 4 ELSE m.office_tier END,
      updated_at = now()
    FROM composites c WHERE m.id = c.market_id"""
    sql(sql_comp)
    print("  ✓ Dual composite + tier updated")

    # 3. Ranks
    sql(
        "WITH rr AS (SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC NULLS LAST, median_household_income DESC NULLS LAST, name ASC) AS r FROM market_research_markets WHERE score IS NOT NULL) "
        "UPDATE market_research_markets m SET rank_residential = rr.r FROM rr WHERE m.id = rr.id"
    )
    sql(
        "WITH ro AS (SELECT id, ROW_NUMBER() OVER (ORDER BY office_score DESC NULLS LAST, median_household_income DESC NULLS LAST, name ASC) AS r FROM market_research_markets WHERE office_score IS NOT NULL) "
        "UPDATE market_research_markets m SET rank_office = ro.r FROM ro WHERE m.id = ro.id"
    )
    print("  ✓ Ranks refreshed")


# ──────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "both"
    if mode == "highway":
        drain_highway()
        recompute()
    elif mode == "phase3":
        drain_phase3()
        recompute()
    elif mode == "both":
        drain_highway()
        drain_phase3()
        recompute()
    elif mode == "recompute":
        recompute()
    else:
        print(__doc__)
        sys.exit(1)
