#!/usr/bin/env python3
"""
sync_balance_sheets.py — Pull Yardi Balance_Sheet xlsx exports from Dropbox
and upsert into Supabase `balance_sheet_items`. Mirror of sync_actuals.py.

Usage:
    python3 scripts/sync_balance_sheets.py                  # dry-run
    python3 scripts/sync_balance_sheets.py --commit         # write to Supabase
    python3 scripts/sync_balance_sheets.py --property p0000003
    python3 scripts/sync_balance_sheets.py --file path/to/Balance_Sheet.xlsx
    python3 scripts/sync_balance_sheets.py --verbose

Looks for files like `Balance_Sheet MM.YY.xlsx` inside each property's
    4 - Accounting / A - Month Quarter Financials / Monthly Financials Reports / MM.YY /

Writes one row per GL line per period. `balance_sheet_items` schema:
    property_id, bs_code, account_name, account_type, account_section,
    is_header, is_total, period (YYYY-MM), amount, sort_order
Unique on (property_id, bs_code, period) — upsert replaces existing.
"""

from __future__ import annotations

import argparse
import glob
import os
import re
import sys
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any

try:
    import openpyxl
    import requests
except ImportError:
    sys.exit("Missing dependency: pip install openpyxl requests")


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
CONFIG_JS = PROJECT_DIR / "config.js"

DROPBOX_ROOTS = [
    Path.home() / "First Mile Prop Dropbox",
    Path.home() / "Library" / "CloudStorage" / "First Mile Prop Dropbox",
    Path.home() / "Library" / "CloudStorage" / "Dropbox-FirstMileCapital",
    Path.home() / "First Mile Dropbox" / "Morris Zeitouni" / "First Mile Prop Dropbox",
    Path.home() / "First Mile Dropbox" / "First Mile Prop Dropbox",
    Path.home() / "Dropbox" / "First Mile Prop Dropbox",
    Path.home() / "First Mile Dropbox",
]
PROPMGMT_DIRNAME = "2.1 FMC Property Management"
ACCOUNTING_DIRNAME = "4 - Accounting"
MONTH_FINANCIALS_DIRNAMES = [
    "A - Month Quarter Financials",
    "A - Month-Quarter Financials",
    "A - month quarter financials",
    "A. Month Quarter Financials",
    "A. Month_Quarter Financials",
]

PROPERTY_MAP: dict[str, dict[str, str]] = {
    "p0000003": {"id": "recQX1kpeJKqIzvkU", "name": "Paramus Plaza"},
    "p0000004": {"id": "recUUsUChvL3yQ96g", "name": "340 Mount Kemble"},
    "p0000005": {"id": "recqfxJfdqCXCLOuD", "name": "61 S Paramus"},
    "p0000006": {"id": "recxF4R64gbb5Sowj", "name": "575 Broadway"},
    "p0000007": {"id": "recF3zFKbY4wJ4P40", "name": "1700 East Putnam"},
}
FOLDER_TO_PROPERTY: dict[str, str | None] = {
    "paramus plaza": "recQX1kpeJKqIzvkU",
    "340 mt kemble morristown": "recUUsUChvL3yQ96g",
    "340 mount kemble": "recUUsUChvL3yQ96g",
    "61 s paramus": "recqfxJfdqCXCLOuD",
    "575 broadway": "recxF4R64gbb5Sowj",
    "1700 east putnam greenwich": "recF3zFKbY4wJ4P40",
    "1700 east putnam": "recF3zFKbY4wJ4P40",
}

FOLDER_SKIPLIST = [
    "0. overall property management",
    "41 flatbush",
    "red bank - 1 river centre",
    "red bank",
]


def db_latest_period(url: str, key: str, property_id: str) -> str:
    """Return the latest (year-month) already loaded in balance_sheet_items."""
    endpoint = f"{url}/rest/v1/balance_sheet_items"
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    params = {
        "property_id": f"eq.{property_id}",
        "select": "period",
        "order": "period.desc",
        "limit": "1",
    }
    try:
        resp = requests.get(endpoint, headers=headers, params=params, timeout=30)
        if resp.status_code == 200:
            rows = resp.json()
            if rows and rows[0].get("period"):
                return rows[0]["period"]
    except Exception:
        pass
    return ""

MONTH_ABBR = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


# ─────────────────────────────────────────────────────────────────────────
# Account section inference from GL code.
# First 2–3 digits indicate the account section.
# ─────────────────────────────────────────────────────────────────────────
def bs_section(bs_code: str) -> tuple[str, str]:
    """Return (account_type, account_section) for a balance-sheet GL code."""
    try:
        c = int(bs_code)
    except (TypeError, ValueError):
        return ("unknown", "unknown")

    if c < 2000:
        atype = "asset"
        if c < 1100:
            sect = "cash"
        elif c < 1200:
            sect = "escrow"
        elif c < 1300:
            sect = "accounts_receivable"
        elif c < 1400:
            sect = "prepaid"
        elif c < 1500:
            sect = "other_current_assets"
        elif c < 1900:
            sect = "fixed_assets"
        elif c < 2000:
            sect = "other_assets"
        else:
            sect = "asset_other"
    elif c < 3000:
        atype = "liability"
        if c < 2100:
            sect = "accounts_payable"
        elif c < 2200:
            sect = "long_term_debt"
        elif c < 2300:
            sect = "accrued_liabilities"
        elif c < 2400:
            sect = "tenant_deposits"
        elif c < 2500:
            sect = "deferred_revenue"
        else:
            sect = "other_liabilities"
    else:
        atype = "equity"
        sect = "equity"
    return (atype, sect)


# ─────────────────────────────────────────────────────────────────────────
# Helpers (Dropbox discovery, materialization, config)
# ─────────────────────────────────────────────────────────────────────────
def find_dropbox_root() -> Path | None:
    for p in DROPBOX_ROOTS:
        if p.exists() and p.is_dir():
            return p
    return None


def find_accounting_folder(prop_folder: Path) -> Path | None:
    accounting = None
    for c in prop_folder.iterdir():
        if c.is_dir() and c.name.lower() == ACCOUNTING_DIRNAME.lower():
            accounting = c
            break
    if not accounting:
        return None
    candidates = [c for c in accounting.iterdir() if c.is_dir()]
    for name in MONTH_FINANCIALS_DIRNAMES:
        for c in candidates:
            if c.name.lower() == name.lower():
                return c
    for c in candidates:
        if c.name.lower().startswith(("a ", "a-", "a.")):
            return c
    return None


def all_balance_sheets(folder: Path) -> list[Path]:
    patterns = [
        "Balance_Sheet*.xlsx", "balance_sheet*.xlsx",
        "Balance Sheet*.xlsx", "balance sheet*.xlsx",
        "*Balance_Sheet*.xlsx", "*balance_sheet*.xlsx",
        "*Balance Sheet*.xlsx", "*balance sheet*.xlsx",
        "BalanceSheet*.xlsx", "*BalanceSheet*.xlsx",
    ]
    seen: set[str] = set()
    out: list[Path] = []
    for pat in patterns:
        for p in glob.glob(str(folder / pat)):
            if p not in seen:
                seen.add(p); out.append(Path(p))
        for p in glob.glob(str(folder / "**" / pat), recursive=True):
            if p not in seen:
                seen.add(p); out.append(Path(p))
    out = [p for p in out if not p.name.startswith("~$")]
    return out


def parse_period_from_name(filename: str) -> tuple[int, int] | None:
    """Extract (year, month) from a filename. Same logic as sync_actuals.py."""
    s = filename
    m = re.search(r"\bQ([1-4])\s+(\d{4})", s, re.I)
    if m:
        return (int(m.group(2)), int(m.group(1)) * 3)
    m = re.search(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s*(\d{2,4})", s, re.I)
    if m:
        mo = MONTH_ABBR[m.group(1).lower()[:3]]
        yr = int(m.group(2))
        yr = yr if yr >= 1900 else 2000 + yr
        return (yr, mo)
    m = re.search(r"\b(\d{1,2})[\.\-/](\d{1,2})[\.\-/](\d{2,4})\b", s)
    if m:
        mo = int(m.group(1))
        yr = int(m.group(3))
        yr = yr if yr >= 1900 else 2000 + yr
        if 1 <= mo <= 12 and yr >= 2020:
            return (yr, mo)
    m = re.search(r"\b(\d{1,2})\.(\d{4})\b", s)
    if m:
        mo = int(m.group(1))
        yr = int(m.group(2))
        if 1 <= mo <= 12:
            return (yr, mo)
    m = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    return None


def latest_balance_sheet(folder: Path) -> Path | None:
    """Return the balance sheet xlsx with the newest PERIOD (not newest mtime).
    A file 'Balance_Sheet 03.31.26.xlsx' beats 'Balance_Sheet 12.31.2025.xlsx'
    even if the latter was refreshed more recently."""
    files = all_balance_sheets(folder)
    if not files:
        return None

    def sort_key(p: Path):
        period = parse_period_from_name(p.name)
        if period:
            # Prefer files WITH a parseable period; newer period wins
            return (1, period[0], period[1], os.path.getmtime(p))
        return (0, 0, 0, os.path.getmtime(p))

    files.sort(key=sort_key, reverse=True)
    return files[0]


def materialize_dropbox_file(path: Path, timeout: int = 300, verbose: bool = True) -> bool:
    """Try several strategies to force Dropbox Files On Demand to download
    the file into local storage. Returns True once size > 0."""
    try:
        if path.stat().st_size > 0:
            return True
    except OSError:
        return False

    import subprocess, tempfile

    # Strategy 1: cat > /dev/null (blocks until File Provider supplies bytes)
    try:
        subprocess.run(["/bin/cat", str(path)], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=timeout, check=False)
    except Exception as e:
        if verbose: print(f"      cat failed: {e}")
    try:
        if path.stat().st_size > 0:
            return True
    except OSError:
        pass

    # Strategy 2: cp to tmpdir (forces full file materialization)
    try:
        with tempfile.NamedTemporaryFile(delete=True) as tmp:
            subprocess.run(["/bin/cp", str(path), tmp.name],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=timeout, check=False)
    except Exception as e:
        if verbose: print(f"      cp failed: {e}")
    try:
        if path.stat().st_size > 0:
            return True
    except OSError:
        pass

    # Strategy 3: `open -g -W` (asks macOS LaunchServices to open, which asks
    # the File Provider to download). -g prevents foregrounding; -W waits.
    try:
        subprocess.run(["/usr/bin/open", "-g", "-W", str(path)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       timeout=timeout, check=False)
    except Exception as e:
        if verbose: print(f"      open failed: {e}")
    try:
        return path.stat().st_size > 0
    except OSError:
        return False


def read_supabase_config() -> tuple[str, str]:
    env_url = os.environ.get("SUPABASE_URL")
    env_key = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
    if env_url and env_key:
        return env_url.rstrip("/"), env_key
    if not CONFIG_JS.exists():
        sys.exit("config.js not found. Set SUPABASE_URL + SUPABASE_KEY env vars.")
    text = CONFIG_JS.read_text()
    url_m = re.search(r"SUPABASE_URL\s*=\s*['\"]([^'\"]+)['\"]", text)
    key_m = re.search(r"SUPABASE_KEY\s*=\s*['\"]([^'\"]+)['\"]", text)
    if not (url_m and key_m):
        sys.exit("Could not parse SUPABASE_URL / SUPABASE_KEY from config.js")
    return url_m.group(1).rstrip("/"), key_m.group(1)


# ─────────────────────────────────────────────────────────────────────────
# Parser
# ─────────────────────────────────────────────────────────────────────────
#  Known account-name → bs_code map extracted from data/setup_balance_sheet.sql
#  Unknown accounts get synthetic codes generated at parse time.
NAME_TO_BS_CODE = {
    "assets": "1000",
    "cash": "1001",
    "operating cash": "1010",
    "flagstar bank": "1012",
    "capital one": "1013",
    "jpm lockbox": "1014",
    "flagstar lockbox": "1015",
    "depository cash": "1020",
    "pnc bank clearing account": "1021",
    "security deposit cash": "1030",
    "escrow cash": "1050",
    "money market account": "1060",
    "pnc bank": "1062",
    "checking account ii": "1063",
    "petty cash": "1080",
    "total cash": "1090",
    "escrow": "1100",
    "escrow - taxes": "1110",
    "escrow - insurance": "1120",
    "req reserves for ti & leasing": "1121",
    "req reserves for ti & leasing (2)": "1128",
    "req reserve for repairs": "1122",
    "req reserve - spec.tt": "1123",
    "req reserve for taxes": "1124",
    "req reserve for misc": "1125",
    "cash- exchange/reserve": "1126",
    "cash - escrow loc/gr lease": "1127",
    "escrow - pnc cash holdback": "1129",
    "escrow - ground rent": "1130",
    "escrow - replacement reserve": "1131",
    "operating expense escrow": "1132",
    "partners reserve": "1133",
    "escrow - bulk sale escrow": "1134",
    "reserve millennium ti work": "1135",
    "total escrow": "1190",
    "accounts receivable": "1200",
    "other receivables": "1230",
    "suspense": "1280",
    "total accounts receivable": "1290",
    "other current assets": "1300",
    "prepaid insurance - property": "1310",
    "prepaid insurance - liability": "1311",
    "prepaid insurance - umbrella": "1312",
    "prepaid insurance - other": "1313",
    "prepaid real estate taxes": "1320",
    "prepaid expenses": "1325",
    "total other current assets": "1390",
    "property": "1400",
    "purchase price credit (reduction)": "1402",
    "land": "1410",
    "acquisition costs - land": "1411",
    "buildings": "1420",
    "acquisition costs - building": "1421",
    "acquisition costs": "1423",
    "equipment": "1424",
    "land improvements": "1430",
    "building improvements": "1440",
    "tenant improvements": "1441",
    "furniture & fixtures": "1450",
    "ad - building": "1480",
    "ad - land improvements": "1481",
    "ad - building improvements": "1482",
    "ad - tenant improvements": "1483",
    "ad - equipment": "1484",
    "ad - acquisition cost": "1485",
    "total property": "1490",
    "other assets": "1600",
    "utility deposits": "1610",
    "loan costs": "1650",
    "aa - loan costs": "1651",
    "deferred leasing commissions": "1667",
    "a/a deferred leasing commissions": "1668",
    "total other assets": "1690",
    "total assets": "1990",
    "liabilities and capital": "2000",
    "liabilities": "2001",
    "accounts payable": "2002",
    "prepaid rent": "2020",
    "tenant deposits": "2050",
    "due to/from seller/buyer": "2070",
    "total accounts payable": "2090",
    "accrued liabilities": "2100",
    "accrued mortgage interest": "2130",
    "accrued expenses & other payables": "2150",
    "total accrued liabilities": "2190",
    "sales tax collected": "2310",
    "short-term liability": "2450",
    "short-term loan": "2451",
    "total short-term liability": "2499",
    "long term liabilities": "2500",
    "long-term liabilities": "2500",
    "mortgage payable": "2510",
    "total long term liabilities": "2590",
    "total liabilities": "2990",
    "capital": "3000",
    "equity": "3000",
    "capital contribution - dra": "3110",
    "distributions - dra": "3120",
    "capital contributions - fm plaza": "3210",
    "distributions - fm plaza": "3220",
    "investment capital": "3230",
    "owner draw": "3231",
    "owner draw - partner": "3232",
    "loan from pref fund ii": "3233",
    "preferred distribution": "3234",
    "current year net income": "3790",
    "retained earnings": "3800",
    "total capital": "3890",
    "total equity": "3890",
    "total liabilities and capital": "3990",
    "total liabilities and equity": "3990",
}


def normalize_name(s: str) -> str:
    """Normalize an account name for map lookup."""
    s = (s or "").strip().lower()
    s = re.sub(r"\s+", " ", s)
    return s


# ── Section detection (account_type + account_section context) ──────
# As we walk the file we maintain a "current context" that we apply to
# leaf rows. Section header rows (UPPERCASE, no amount) change the context.
SECTION_HINTS = [
    ("ASSETS",                   "asset",      None),
    ("LIABILITIES AND CAPITAL",  None,         None),              # just a super-header
    ("LIABILITIES AND EQUITY",   None,         None),
    ("LIABILITIES",              "liability",  None),
    ("CAPITAL",                  "equity",     "equity"),
    ("EQUITY",                   "equity",     "equity"),
    ("CASH",                     "asset",      "cash"),
    ("ESCROW",                   "asset",      "escrow"),
    ("ACCOUNTS RECEIVABLE",      "asset",      "accounts_receivable"),
    ("OTHER CURRENT ASSETS",     "asset",      "prepaid"),
    ("PROPERTY",                 "asset",      "fixed_assets"),
    ("OTHER ASSETS",             "asset",      "other_assets"),
    ("ACCOUNTS PAYABLE",         "liability",  "accounts_payable"),
    ("ACCRUED LIABILITIES",      "liability",  "accrued_liabilities"),
    ("SHORT-TERM LIABILITY",     "liability",  "other_liabilities"),
    ("SHORT TERM LIABILITIES",   "liability",  "other_liabilities"),
    ("LONG TERM LIABILITIES",    "liability",  "long_term_debt"),
    ("LONG-TERM LIABILITIES",    "liability",  "long_term_debt"),
]


def detect_section(upper: str) -> tuple[str | None, str | None]:
    """Return (account_type_hint, account_section_hint) or (None, None)."""
    for keyword, atype, sect in SECTION_HINTS:
        if upper == keyword or upper.startswith(keyword + " "):
            return (atype, sect)
    return (None, None)


def parse_balance_sheet(path: Path) -> dict[str, Any]:
    """Parse a Yardi Balance Sheet xlsx.

    Real format (as of April 2026):
      Row 1: Balance Sheet
      Row 2: Property = <Name> (pXXXXXXX)
      Row 3: Period = MM/YYYY - MM/YYYY
      Row 4: Book = ...
      Row 5: ACCOUNT | CURRENT BALANCE
      Row 6+: data rows, col 0 = indented account name, col 1 = amount.
              Section headers (ASSETS, CASH, ESCROW, etc.) are uppercase
              and have no amount.

    Returns:
        property_code, property_name, year, month, period (YYYY-MM),
        rows: [{bs_code, account_name, amount, is_header, is_total,
                account_type, account_section, sort_order}],
        source_file
    """
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    all_rows = list(ws.iter_rows(values_only=True))

    property_code = property_name = None
    year = None
    month = None
    header_row_idx = None
    amount_col = None

    for i, row in enumerate(all_rows):
        if not row:
            continue
        c0 = row[0]
        if c0 is not None:
            s = str(c0).strip()
            m_prop = re.search(r"(.+?)\s*\(([pP]\d+)\)", s)
            if m_prop and not property_code:
                property_name = m_prop.group(1).strip()
                property_code = m_prop.group(2).strip().lower()
                continue
            if s.lower().startswith("period"):
                m = re.search(
                    r"(\d{1,2})/(\d{4})\s*[-–]\s*(\d{1,2})/(\d{4})", s
                )
                if m:
                    # Use END of period (second month/year)
                    month = int(m.group(3))
                    year = int(m.group(4))
                else:
                    m = re.search(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})", s, re.I)
                    if m:
                        month = MONTH_ABBR[m.group(1).lower()[:3]]
                        year = int(m.group(2))
                continue
        cells = [str(c).strip().lower() if c is not None else "" for c in row]
        joined = " | ".join(cells)
        if "account" in joined and ("balance" in joined or "amount" in joined):
            # Pick first non-"account" column that contains "balance" or "amount"
            for j, c in enumerate(cells):
                if c and c != "account" and ("balance" in c or "amount" in c):
                    amount_col = j
                    break
            if amount_col is None:
                # Fall back to second column
                amount_col = 1
            header_row_idx = i
            break

    if header_row_idx is None:
        raise ValueError(f"Could not locate header row in {path.name}")
    if amount_col is None:
        amount_col = 1

    if not property_code:
        m = re.search(r"(p\d{7})", path.name, re.I)
        if m:
            property_code = m.group(1).lower()
    if not property_code:
        raise ValueError(f"Could not determine property code from {path.name}")

    # Period fallback — try to parse from filename
    if not (year and month):
        m = re.search(r"(\d{1,2})[\.\-/](\d{1,2})[\.\-/](\d{2,4})", path.name)
        if m:
            month = int(m.group(1))
            yr = int(m.group(3))
            year = yr if yr >= 1900 else 2000 + yr
    if not (year and month):
        raise ValueError(f"Could not determine year/month for {path.name}")

    period = f"{year:04d}-{month:02d}"

    # Auto-detect format: does col 0 contain GL codes (4-digit numbers)?
    # If so, col 0 = GL, col 1 = account name, col amount_col = balance.
    gl_in_col0 = False
    gl_probe = 0
    for row in all_rows[header_row_idx + 1 : header_row_idx + 30]:
        if not row or row[0] is None:
            continue
        c0 = str(row[0]).strip()
        if re.match(r"^\d{4}(-[\d]+)*(-[\d]+)*$", c0) or re.match(r"^\d{4}$", c0):
            gl_probe += 1
            if gl_probe >= 3:
                gl_in_col0 = True
                break
    # When GL codes are in col 0, the amount column may shift right — re-detect
    if gl_in_col0:
        # Find first row that has a 4-digit GL and a numeric value
        for row in all_rows[header_row_idx + 1 : header_row_idx + 40]:
            if not row or row[0] is None:
                continue
            c0 = str(row[0]).strip()
            if not re.match(r"^\d{4}", c0):
                continue
            for j in range(len(row) - 1, 1, -1):
                v = row[j]
                try:
                    if v not in (None, "") and abs(float(v)) > 0:
                        amount_col = j
                        break
                except (TypeError, ValueError):
                    continue
            break

    # ── Walk data rows with section context ─────────────────────────
    rows: list[dict[str, Any]] = []
    sort_order = 0
    cur_type: str | None = None
    cur_section: str | None = None
    synthetic_counter = 9000  # for accounts not in NAME_TO_BS_CODE map

    for row in all_rows[header_row_idx + 1 :]:
        if not row:
            continue
        c0 = row[0]
        if c0 is None:
            continue

        # If GL codes are in col 0, pull bs_code from col 0 and name from col 1
        if gl_in_col0:
            c0_str = str(c0).strip()
            gl_match = re.match(r"^(\d{4})", c0_str)
            if gl_match:
                explicit_bs_code = gl_match.group(1)
                # Name is in col 1
                name_raw = str(row[1]) if len(row) > 1 and row[1] is not None else ""
                name_stripped = name_raw.strip()
                if not name_stripped:
                    continue
                upper = name_stripped.upper()
                amount_val = row[amount_col] if amount_col < len(row) else None
                # Skip if no amount (header row)
                if amount_val in (None, ""):
                    # Still record header-style rows (section titles)
                    type_hint, section_hint = detect_section(upper)
                    if type_hint is not None:
                        cur_type = type_hint
                    if section_hint is not None:
                        cur_section = section_hint
                    sort_order += 10
                    rows.append({
                        "bs_code": explicit_bs_code,
                        "account_name": name_stripped,
                        "amount": 0.0,
                        "is_header": True,
                        "is_total": upper.startswith("TOTAL"),
                        "account_type": cur_type or bs_section(explicit_bs_code)[0],
                        "account_section": cur_section or bs_section(explicit_bs_code)[1],
                        "sort_order": sort_order,
                    })
                    continue
                try:
                    amount = float(amount_val)
                except (TypeError, ValueError):
                    amount = 0.0
                is_total = upper.startswith("TOTAL")
                atype_from_code, sect_from_code = bs_section(explicit_bs_code)
                # Update section context based on GL code prefix
                type_hint, section_hint = detect_section(upper)
                if type_hint is not None:
                    cur_type = type_hint
                if section_hint is not None:
                    cur_section = section_hint
                sort_order += 10
                rows.append({
                    "bs_code": explicit_bs_code,
                    "account_name": name_stripped,
                    "amount": round(amount, 2),
                    "is_header": False,
                    "is_total": is_total,
                    "account_type": cur_type or atype_from_code,
                    "account_section": cur_section or sect_from_code,
                    "sort_order": sort_order,
                })
                continue
            # c0 exists but not a GL code — skip (might be a subtotal header)
            continue

        # --- Name-based format (legacy) ---
        name_raw = str(c0)
        # Preserve leading spaces to understand indent depth (Yardi uses leading spaces)
        name_stripped = name_raw.strip()
        if not name_stripped:
            continue

        upper = name_stripped.upper()
        amount_val = row[amount_col] if amount_col < len(row) else None

        # Is this a section header? (no amount + recognizable keyword)
        amount_is_empty = (amount_val is None or amount_val == "")
        type_hint, section_hint = detect_section(upper)
        if amount_is_empty and (type_hint is not None or section_hint is not None):
            if type_hint is not None:
                cur_type = type_hint
            if section_hint is not None:
                cur_section = section_hint
            # Also record the header row itself so the UI can display section titles
            norm = normalize_name(name_stripped)
            bs_code = NAME_TO_BS_CODE.get(norm)
            if bs_code:
                sort_order += 10
                rows.append({
                    "bs_code": bs_code,
                    "account_name": name_stripped,
                    "amount": 0.0,
                    "is_header": True,
                    "is_total": False,
                    "account_type": cur_type or "unknown",
                    "account_section": cur_section or "unknown",
                    "sort_order": sort_order,
                })
            continue

        # Parse amount
        try:
            amount = float(amount_val) if amount_val not in (None, "") else 0.0
        except (TypeError, ValueError):
            amount = 0.0

        is_total = upper.startswith("TOTAL")
        norm = normalize_name(name_stripped)
        bs_code = NAME_TO_BS_CODE.get(norm)
        if not bs_code:
            # Unknown account — generate synthetic code within the current section.
            # Prefix with the section's base code (10 for cash, 11 for escrow, ...)
            base = {"cash":"10","escrow":"11","accounts_receivable":"12","prepaid":"13",
                    "fixed_assets":"14","other_assets":"16","accounts_payable":"20",
                    "accrued_liabilities":"21","long_term_debt":"25","equity":"30"}.get(cur_section, "99")
            synthetic_counter += 1
            bs_code = f"{base}{synthetic_counter}"

        # Apply section context; override with bs_section() if it disagrees
        atype_from_code, sect_from_code = bs_section(bs_code)
        account_type = cur_type or atype_from_code
        account_section = cur_section or sect_from_code

        sort_order += 10
        rows.append({
            "bs_code": bs_code,
            "account_name": name_stripped,
            "amount": round(amount, 2),
            "is_header": False,
            "is_total": is_total,
            "account_type": account_type,
            "account_section": account_section,
            "sort_order": sort_order,
        })

    return {
        "property_code": property_code,
        "property_name": property_name,
        "year": year,
        "month": month,
        "period": period,
        "rows": rows,
        "source_file": str(path),
    }


# ─────────────────────────────────────────────────────────────────────────
# Supabase upsert
# ─────────────────────────────────────────────────────────────────────────
def supabase_upsert(url: str, key: str, property_id: str, period: str,
                    rows: list[dict[str, Any]]) -> int:
    endpoint = f"{url}/rest/v1/balance_sheet_items"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal,resolution=merge-duplicates",
    }
    # Delete any existing rows for this property+period first (idempotent replace)
    del_resp = requests.delete(
        endpoint, headers=headers,
        params={"property_id": f"eq.{property_id}", "period": f"eq.{period}"},
        timeout=60,
    )
    if del_resp.status_code not in (200, 204):
        raise RuntimeError(f"DELETE failed ({del_resp.status_code}): {del_resp.text[:400]}")

    if not rows:
        return 0

    payload = []
    for r in rows:
        payload.append({
            "property_id": property_id,
            "bs_code": r["bs_code"],
            "account_name": r["account_name"],
            "account_type": r["account_type"],
            "account_section": r["account_section"],
            "is_header": r["is_header"],
            "is_total": r["is_total"],
            "period": period,
            "amount": r["amount"],
            "sort_order": r["sort_order"],
        })

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
# Discovery
# ─────────────────────────────────────────────────────────────────────────
def discover_files(explicit_file: str | None, only_property: str | None) -> dict[str, Path]:
    if explicit_file:
        p = Path(explicit_file).expanduser().resolve()
        if not p.exists():
            sys.exit(f"File not found: {p}")
        return {p.name: p}

    root = find_dropbox_root()
    if root is None:
        print("⚠ Dropbox root not found.", file=sys.stderr)
        return {}

    propmgmt = root / PROPMGMT_DIRNAME
    if not propmgmt.exists():
        for child in root.iterdir():
            if child.is_dir() and "property management" in child.name.lower():
                propmgmt = child
                break
        else:
            print(f"Could not find '{PROPMGMT_DIRNAME}' in {root}")
            return {}

    print(f"✓ Scanning {propmgmt}")
    out: dict[str, Path] = {}
    for child in sorted(propmgmt.iterdir()):
        if not child.is_dir():
            continue
        if any(skip in child.name.lower() for skip in FOLDER_SKIPLIST):
            print(f"  ⏭  {child.name}: skiplisted")
            continue
        if only_property and only_property.lower() not in child.name.lower():
            continue
        acct = find_accounting_folder(child)
        if not acct:
            print(f"  ⏭  {child.name}: no accounting subfolder")
            continue
        bs = latest_balance_sheet(acct)
        if not bs:
            print(f"  ⏭  {child.name}: no Balance_Sheet*.xlsx found")
            continue
        print(f"  ✓ {child.name}: {bs.name}")
        out[child.name] = bs
    return out


# ─────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--commit", action="store_true", help="Actually write to Supabase.")
    ap.add_argument("--property", help="Folder-name substring filter.")
    ap.add_argument("--file", help="Process a single xlsx and stop.")
    ap.add_argument("--verbose", "-v", action="store_true")
    ap.add_argument(
        "--force-refresh", action="store_true",
        help="Reload files even if their period is already in Supabase.",
    )
    args = ap.parse_args()

    found = discover_files(args.file, args.property)
    if not found:
        print("No balance sheet files found. Use --file to point at one.")
        return 1

    supabase_url = supabase_key = None
    if args.commit:
        supabase_url, supabase_key = read_supabase_config()

    total_inserted = 0
    for folder_name, path in found.items():
        print(f"\n━━━ {folder_name} ━━━")
        print(f"  file: {path.name}")

        # Freshness check: do we already have this period loaded?
        property_id_for_folder = None
        for key, pid in FOLDER_TO_PROPERTY.items():
            if key in folder_name.lower() or folder_name.lower() in key:
                property_id_for_folder = pid
                break

        filename_period = None
        import re as _re
        m = _re.search(r"(\d{1,2})[\.\-/](\d{1,2})[\.\-/](\d{2,4})", path.name)
        if m:
            mo = int(m.group(1))
            yr = int(m.group(3))
            yr = yr if yr >= 1900 else 2000 + yr
            if 1 <= mo <= 12:
                filename_period = f"{yr:04d}-{mo:02d}"

        if (args.commit and property_id_for_folder and filename_period
                and not args.force_refresh):
            latest_in_db = db_latest_period(supabase_url, supabase_key, property_id_for_folder)
            if latest_in_db and latest_in_db >= filename_period:
                print(f"  ⏭  period {filename_period} already loaded (db has thru {latest_in_db})")
                continue

        # Materialize if online-only
        try:
            sz = path.stat().st_size
        except OSError:
            sz = 0
        if sz == 0:
            print("  … pulling down online-only file from Dropbox …")
            if not materialize_dropbox_file(path):
                print("  ✗ Dropbox download timed out")
                continue
            print(f"  ✓ materialized ({path.stat().st_size:,} bytes)")

        try:
            parsed = parse_balance_sheet(path)
        except Exception as e:
            print(f"  ✗ parse error: {e}")
            continue

        prop_code = parsed["property_code"]
        map_entry = PROPERTY_MAP.get(prop_code)
        if not map_entry:
            print(f"  ✗ Unknown property code {prop_code!r}. Add to PROPERTY_MAP.")
            continue
        supa_id = map_entry["id"]

        print(f"  property  : {parsed['property_name']} ({prop_code}) → {supa_id}")
        print(f"  period    : {parsed['period']}")
        print(f"  rows      : {len(parsed['rows'])} line items")

        if args.verbose:
            for r in parsed["rows"][:25]:
                flag = "H" if r["is_header"] else ("T" if r["is_total"] else " ")
                print(f"      [{flag}] {r['bs_code']:>6}  {r['account_name'][:40]:40s}  "
                      f"{r['account_type']:>9}  {r['amount']:>14,.2f}")

        if args.commit:
            n = supabase_upsert(supabase_url, supabase_key, supa_id, parsed["period"], parsed["rows"])
            total_inserted += n
            print(f"  ✓ upserted {n} rows")
        else:
            total_inserted += len(parsed["rows"])
            print(f"  (dry-run) would upsert {len(parsed['rows'])} rows")

    print("\n━━━ summary ━━━")
    print(f"  properties : {len(found)}")
    print(f"  rows       : {total_inserted}")
    print(f"  mode       : {'COMMIT' if args.commit else 'dry-run'}")
    if not args.commit:
        print("\nRe-run with --commit to actually write.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
