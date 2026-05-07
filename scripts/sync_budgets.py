#!/usr/bin/env python3
"""
sync_budgets.py — Pull annual Yardi 12-month budget xlsx exports from Dropbox
and upsert into Supabase `budget_line_items`.

Mirrors sync_actuals.py but:
  - Targets budget files (filename patterns like "twelvemonthbudget_*", "*budget*.xlsx")
  - Writes to `budget_line_items` instead of `actuals_line_items`
  - Same Yardi 12-month layout (Account in col A, Jan..Dec across, ANNUAL last)
  - Uses the same name→GL code mapping (gl-accounts.json + NAME_OVERRIDES)

Usage:
    python3 scripts/sync_budgets.py                      # dry-run, all properties
    python3 scripts/sync_budgets.py --commit             # write to Supabase
    python3 scripts/sync_budgets.py --year 2025          # filter to one year
    python3 scripts/sync_budgets.py --property p0000005  # one property
    python3 scripts/sync_budgets.py --file path/to.xlsx  # process one file
    python3 scripts/sync_budgets.py --list               # just list files found

Search strategy: each property's `4 - Accounting/` is walked recursively for
any xlsx whose name contains 'budget' (case-insensitive). The newest file
matching the requested --year is used.
"""

from __future__ import annotations

import argparse
import glob
import os
import re
import sys
from pathlib import Path
from typing import Any

# Reuse helpers from sync_actuals.py (same directory)
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

try:
    import openpyxl  # noqa: F401  (used transitively by sync_actuals)
    import requests
except ImportError:
    sys.exit("Missing dependency: pip install openpyxl requests")

from sync_actuals import (  # type: ignore
    DROPBOX_ROOTS,
    PROPMGMT_DIRNAME,
    ACCOUNTING_DIRNAME,
    PROPERTY_MAP,
    FOLDER_TO_PROPERTY,
    FOLDER_SKIPLIST,
    find_dropbox_root,
    find_accounting_folder,
    materialize_dropbox_file,
    parse_income_statement,
    parse_period_from_name,
    load_name_to_gl,
    load_gl_accounts_by_code,
    read_supabase_config,
)
import openpyxl  # noqa: E402


# ─────────────────────────────────────────────────────────────────────────
# Yardi "Budget Comparison Report" parser
# Header row: A=GL, B=Account, C=PTD Actual, D=PTD Budget, E=Variance, F=% Var,
#             G=YTD Actual, H=YTD Budget, I=Variance, J=% Var, K=Annual
# We use the "Annual" column (K) — that's the full-year budget regardless of
# what period the report was run for. Even-split across 12 months.
# ─────────────────────────────────────────────────────────────────────────
def parse_budget_comparison(path) -> dict[str, Any] | None:
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    all_rows = list(ws.iter_rows(values_only=True))

    # Property name + code from header rows (row 1 typically: "FM Sixty One Paramus, LLC (p0000005)")
    property_code = property_name = None
    year = None
    for r in all_rows[:8]:
        if not r:
            continue
        for c in r:
            if c is None:
                continue
            s = str(c).strip()
            m = re.search(r"(.+?)\s*\(([pP]\d+)\)", s)
            if m and not property_code:
                property_name = m.group(1).strip()
                property_code = m.group(2).strip().lower()
            m = re.search(r"period\s*=\s*\w+\s*\d*\s*-?\s*\w*\s*(\d{4})", s, re.I)
            if m and not year:
                year = int(m.group(1))
            m = re.search(r"\b(20\d{2})\b", s)
            if m and not year:
                year = int(m.group(1))

    # Locate header row + Annual / YTD Budget columns
    header_idx = None
    annual_col = ytd_budget_col = None
    for i, row in enumerate(all_rows[:15]):
        if not row:
            continue
        cells = [str(c).strip().lower() if c is not None else "" for c in row]
        joined = " | ".join(cells)
        if "ptd actual" in joined and "ytd actual" in joined:
            header_idx = i
            for j, c in enumerate(cells):
                if c == "annual":
                    annual_col = j
                elif "ytd budget" in c and ytd_budget_col is None:
                    ytd_budget_col = j
            break
    if header_idx is None:
        return None  # Not this format

    budget_col = annual_col if annual_col is not None else ytd_budget_col
    if budget_col is None:
        return None

    rows: list[dict[str, Any]] = []
    for row in all_rows[header_idx + 1:]:
        if not row or row[0] is None:
            continue
        gl_raw = str(row[0]).strip()
        if not re.match(r"^\d{4}$", gl_raw):
            continue
        gl = gl_raw
        acct_name = str(row[1]).strip() if len(row) > 1 and row[1] is not None else ""
        if not acct_name:
            continue

        # Read budget value (col K = Annual)
        val = row[budget_col] if budget_col < len(row) else None
        if val is None or val == "":
            continue
        try:
            annual = float(val)
        except (TypeError, ValueError):
            continue
        if annual == 0:
            continue

        # Even-split across 12 months. Last month absorbs rounding remainder
        # so the sum equals the annual figure exactly.
        per_month = round(annual / 12, 2)
        months = {m: per_month for m in range(1, 12)}
        months[12] = round(annual - 11 * per_month, 2)

        rows.append({
            "account_name": acct_name,
            "gl_code": gl,
            "months": months,
        })

    # Property code fallback from filename
    if not property_code:
        m = re.search(r"(p\d{7})", path.name, re.I)
        if m:
            property_code = m.group(1).lower()

    return {
        "property_code": property_code,
        "property_name": property_name,
        "year": year,
        "rows": rows,
        "unmatched": [],
        "source_file": str(path),
        "_format": "budget_comparison",
    }


def parse_budget_file(path, name_to_gl):
    """Try Yardi Budget-Comparison format first, then fall back to 12-month."""
    try:
        bc = parse_budget_comparison(path)
        if bc is not None and bc.get("rows"):
            return bc
    except Exception:
        pass
    return parse_income_statement(path, name_to_gl)


# ─────────────────────────────────────────────────────────────────────────
# Discovery — budget files
# ─────────────────────────────────────────────────────────────────────────
BUDGET_PATTERNS = [
    "*twelvemonthbudget*.xlsx",
    "*twelve month budget*.xlsx",
    "*12monthbudget*.xlsx",
    "*12 month budget*.xlsx",
    "*Budget*.xlsx",
    "*budget*.xlsx",
    "*BUDGET*.xlsx",
]

# Files that look like budgets but aren't Yardi 12-month exports we can parse.
# These names sometimes appear in property folders (CAM recs, Argus exports,
# variance reports, etc.) — skip them rather than failing.
BUDGET_SKIP_NAME_PATTERNS = [
    re.compile(r"variance", re.I),
    re.compile(r"reforecast", re.I),
    re.compile(r"reconciliation", re.I),
    re.compile(r"argus", re.I),
    re.compile(r"draft", re.I),       # often working copies; prefer final
]


def all_budget_files(folder: Path) -> list[Path]:
    """Return every xlsx in `folder` (recursive) whose name contains 'budget'."""
    seen: set[str] = set()
    out: list[Path] = []
    for pat in BUDGET_PATTERNS:
        for p in glob.glob(str(folder / pat)):
            if p not in seen:
                seen.add(p); out.append(Path(p))
        for p in glob.glob(str(folder / "**" / pat), recursive=True):
            if p not in seen:
                seen.add(p); out.append(Path(p))
    # Filter Excel lock files + obvious non-budgets
    cleaned: list[Path] = []
    for p in out:
        if p.name.startswith("~$"):
            continue
        if any(rx.search(p.name) for rx in BUDGET_SKIP_NAME_PATTERNS):
            continue
        cleaned.append(p)
    return cleaned


def parse_year_from_budget_name(filename: str) -> int | None:
    """Pull a 4-digit year out of a budget filename."""
    m = re.search(r"(20\d{2})", filename)
    if m:
        yr = int(m.group(1))
        if 2020 <= yr <= 2035:
            return yr
    # Fall back to the actuals filename parser (handles MM.YYYY, etc.)
    period = parse_period_from_name(filename)
    return period[0] if period else None


def discover_budget_files(
    explicit_file: str | None,
    only_property: str | None,
    only_year: int | None,
) -> dict[str, list[Path]]:
    """Return {folder_name: [paths]} for all candidate budget files."""
    if explicit_file:
        p = Path(explicit_file).expanduser().resolve()
        if not p.exists():
            sys.exit(f"File not found: {p}")
        return {p.name: [p]}

    root = find_dropbox_root()
    if root is None:
        print("⚠ Dropbox root not found.", file=sys.stderr)
        return {}
    propmgmt = root / PROPMGMT_DIRNAME
    if not propmgmt.exists():
        print(f"⚠ '{PROPMGMT_DIRNAME}' not found under {root}", file=sys.stderr)
        return {}
    print(f"✓ Scanning {propmgmt}")

    out: dict[str, list[Path]] = {}
    for child in sorted(propmgmt.iterdir()):
        if not child.is_dir():
            continue
        if any(skip in child.name.lower() for skip in FOLDER_SKIPLIST):
            print(f"  ⏭  {child.name}: skiplisted")
            continue
        if only_property and only_property.lower() not in child.name.lower():
            continue
        acct = find_accounting_folder(child)
        # Even if no "A - Month Quarter Financials" subfolder exists, budgets
        # might be in another sub-area like "B - Budgets" or directly in
        # `4 - Accounting/`. Search the whole accounting folder.
        accounting_root = child / ACCOUNTING_DIRNAME
        if not accounting_root.exists():
            for c in child.iterdir():
                if c.is_dir() and c.name.lower() == ACCOUNTING_DIRNAME.lower():
                    accounting_root = c
                    break
        if not accounting_root.exists():
            print(f"  ⏭  {child.name}: no '{ACCOUNTING_DIRNAME}' folder")
            continue

        files = all_budget_files(accounting_root)
        if only_year:
            yfiles = [f for f in files if parse_year_from_budget_name(f.name) == only_year]
            files = yfiles
        if not files:
            print(f"  ⏭  {child.name}: no budget xlsx (year={only_year or 'any'})")
            continue
        # Sort newest first by mtime; we'll group by year and keep latest per year.
        files.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        # Bucket by year, keep newest per year
        by_year: dict[int, Path] = {}
        for f in files:
            y = parse_year_from_budget_name(f.name)
            if y is None:
                continue
            if y not in by_year:
                by_year[y] = f
        if not by_year:
            print(f"  ⏭  {child.name}: budget files found but no parseable year in filenames")
            for f in files[:3]:
                rel = f.relative_to(accounting_root)
                print(f"      candidate: {rel}")
            continue
        chosen = list(by_year.values())
        for f in chosen:
            y = parse_year_from_budget_name(f.name)
            rel = f.relative_to(accounting_root)
            print(f"  ✓ {child.name}: {y} → {rel}")
        out[child.name] = chosen
    return out


# ─────────────────────────────────────────────────────────────────────────
# Supabase upsert (mirrors sync_actuals' implementation, table swapped)
# ─────────────────────────────────────────────────────────────────────────
def supabase_upsert_budget(
    url: str,
    key: str,
    property_id: str,
    year: int,
    rows: list[dict[str, Any]],
    gl_by_code: dict[str, dict[str, Any]],
    verbose: bool = True,
) -> int:
    endpoint = f"{url}/rest/v1/budget_line_items"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    # 1) Delete existing
    del_resp = requests.delete(
        endpoint, headers=headers,
        params={"property_id": f"eq.{property_id}", "year": f"eq.{year}"},
        timeout=60,
    )
    if del_resp.status_code not in (200, 204):
        raise RuntimeError(f"DELETE failed ({del_resp.status_code}): {del_resp.text[:400]}")
    if verbose:
        print(f"    cleared existing budget for {property_id} / {year}")

    # 2) Build payload
    payload: list[dict[str, Any]] = []
    for r in rows:
        gl = r["gl_code"]
        acct = gl_by_code.get(gl, {}).get("name") or r["account_name"]
        for month, amount in sorted(r["months"].items()):
            payload.append({
                "property_id": property_id,
                "year": year,
                "gl_code": gl,
                "account_name": acct,
                "month": month,
                "amount": round(float(amount), 2),
            })
    if not payload:
        return 0

    # 3) Insert in chunks
    chunk = 500
    inserted = 0
    for i in range(0, len(payload), chunk):
        part = payload[i : i + chunk]
        resp = requests.post(endpoint, headers=headers, json=part, timeout=120)
        if resp.status_code not in (200, 201, 204):
            raise RuntimeError(f"POST failed ({resp.status_code}): {resp.text[:400]}")
        inserted += len(part)
    return inserted


# ─────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--commit", action="store_true", help="Actually write to Supabase.")
    ap.add_argument("--year", type=int, help="Only ingest budgets for this year (e.g. 2025).")
    ap.add_argument("--property", help="Folder-name substring filter.")
    ap.add_argument("--file", help="Process a single xlsx and stop.")
    ap.add_argument("--list", action="store_true", help="Just list what would be processed and exit.")
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args()

    grouped = discover_budget_files(args.file, args.property, args.year)
    if not grouped:
        print("No budget files found. Try --list to see what's in the tree.")
        return 1

    if args.list:
        print("\nDiscovered budget files:")
        for folder, paths in grouped.items():
            print(f"  {folder}:")
            for p in paths:
                yr = parse_year_from_budget_name(p.name)
                print(f"    {yr} → {p}")
        return 0

    name_to_gl = load_name_to_gl()
    gl_by_code = load_gl_accounts_by_code()

    supabase_url = supabase_key = None
    if args.commit:
        supabase_url, supabase_key = read_supabase_config()

    total_inserted = 0
    any_unmatched = False

    for folder_name, file_paths in grouped.items():
        print(f"\n━━━ {folder_name} ━━━")
        for f in file_paths:
            # Materialize Dropbox online-only file
            try:
                sz = f.stat().st_size
            except OSError:
                sz = 0
            if sz == 0:
                print(f"  … pulling down {f.name} from Dropbox …")
                if not materialize_dropbox_file(f):
                    print(f"  ✗ timed out downloading {f.name} — skipping")
                    continue
                print(f"  ✓ materialized ({f.stat().st_size:,} bytes)")

            try:
                parsed = parse_budget_file(f, name_to_gl)
            except Exception as e:
                print(f"  ✗ {f.name}: parse error: {e}")
                continue

            fmt = parsed.get("_format", "unknown")
            if fmt not in ("twelve_month", "budget_comparison"):
                print(f"  ⚠  {f.name}: format='{fmt}' — skipping")
                continue

            yr = args.year or parsed.get("year")
            if not yr:
                print(f"  ✗ {f.name}: no year parsed — skipping")
                continue
            if args.year and parsed.get("year") and parsed["year"] != args.year:
                print(f"  ⏭  {f.name}: file year {parsed['year']} != --year {args.year}")
                continue

            prop_code = parsed["property_code"]
            prop_name = parsed["property_name"]
            rows = parsed["rows"]
            unmatched = parsed.get("unmatched", [])

            # Resolve property_id
            entry = PROPERTY_MAP.get(prop_code.lower())
            if not entry:
                # fall back to folder name lookup
                key = folder_name.lower().strip()
                pid = FOLDER_TO_PROPERTY.get(key) or next(
                    (v for k, v in FOLDER_TO_PROPERTY.items() if k in key or key in k), None
                )
                if not pid:
                    print(f"  ✗ {f.name}: property_code='{prop_code}' not in PROPERTY_MAP")
                    continue
                supa_id = pid
            else:
                supa_id = entry["id"]

            # Normalize year filter
            if args.year and yr != args.year:
                continue

            line_count = sum(len(r["months"]) for r in rows)
            print(f"  {f.name}")
            print(f"    property : {prop_name} ({prop_code}) → {supa_id}")
            print(f"    year     : {yr}")
            print(f"    rows     : {len(rows)}  ({line_count} GL × month cells)")
            if unmatched:
                any_unmatched = True
                print(f"    ⚠ unmatched account names ({len(unmatched)}):")
                for u in unmatched[:8]:
                    print(f"        · {u}")
                if len(unmatched) > 8:
                    print(f"        … and {len(unmatched) - 8} more")

            if args.verbose:
                for r in rows[:15]:
                    total = sum(r["months"].values())
                    print(f"      {r['gl_code']:>6}  {r['account_name'][:34]:34s}  ${total:>15,.2f}")

            if args.commit:
                try:
                    n = supabase_upsert_budget(
                        supabase_url, supabase_key, supa_id, yr, rows, gl_by_code,
                        verbose=args.verbose,
                    )
                    print(f"    ✓ upserted {n} rows to budget_line_items")
                    total_inserted += n
                except Exception as e:
                    print(f"    ✗ upsert failed: {e}")
            else:
                print("    (dry-run — pass --commit to write)")

    print(f"\n━━━ summary ━━━")
    print(f"  files processed   : {sum(len(v) for v in grouped.values())}")
    print(f"  rows inserted     : {total_inserted}")
    print(f"  mode              : {'COMMIT' if args.commit else 'DRY-RUN'}")
    if any_unmatched:
        print("  ⚠ Some account names didn't map to a GL code. Add them to "
              "NAME_OVERRIDES in sync_actuals.py if they're real lines.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
