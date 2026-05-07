#!/usr/bin/env python3
"""
extract_61paramus_2025_debt.py — Parse 2025 monthly mortgage billing
statements for 61 S Paramus and emit SQL inserts for actuals_line_items.

Two loans:
    327891008 → GL 7152 (1st Mortgage Interest)
    327891108 → GL 7153 (2nd Mortgage Interest)
Plus a per-month rollup row at GL 7199 (TOTAL DEBT SERVICE).

Usage:
    # 1) Inspect: dump raw PDF text so we can see the layout
    python3 scripts/extract_61paramus_2025_debt.py --dump

    # 2) Parse + emit SQL (writes to data/insert_61paramus_2025_debt.sql)
    python3 scripts/extract_61paramus_2025_debt.py

    # 3) Combine: dump one file's text without writing SQL
    python3 scripts/extract_61paramus_2025_debt.py --dump-one 9

Tries pypdf first, then pdftotext (poppler) as a fallback.
If neither is installed, the script auto-installs pypdf via pip.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path


def _ensure_pypdf():
    """Import pypdf, installing it if needed."""
    try:
        import pypdf  # noqa: F401
        return True
    except ImportError:
        print("Installing pypdf …")
        for cmd in (
            [sys.executable, "-m", "pip", "install", "--quiet", "pypdf"],
            [sys.executable, "-m", "pip", "install", "--quiet", "--break-system-packages", "pypdf"],
            [sys.executable, "-m", "pip", "install", "--quiet", "--user", "pypdf"],
        ):
            try:
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
                if r.returncode == 0:
                    break
            except Exception:
                continue
        try:
            import pypdf  # noqa: F401
            return True
        except ImportError:
            return False


_HAS_PYPDF = _ensure_pypdf()

PROPERTY_ID = "recqfxJfdqCXCLOuD"
LOAN_GL = {
    "327891008": ("7152", "1st Mortgage Interest"),
    "327891108": ("7153", "2nd Mortgage Interest"),
}
YEAR = 2025

DROPBOX_ROOTS = [
    Path.home() / "First Mile Prop Dropbox",
    Path.home() / "Library" / "CloudStorage" / "First Mile Prop Dropbox",
]
PROP_FOLDER = "2.1 FMC Property Management/61 S Paramus"

OUT_SQL = Path(__file__).resolve().parent.parent / "data" / "insert_61paramus_2025_debt.sql"


def find_dropbox_root() -> Path:
    for r in DROPBOX_ROOTS:
        if r.exists():
            return r
    sys.exit(f"Dropbox not found. Tried: {[str(r) for r in DROPBOX_ROOTS]}")


def materialize(p: Path, timeout: int = 120) -> bool:
    """Force Dropbox online-only file to materialize locally."""
    try:
        if p.stat().st_size > 0:
            return True
    except OSError:
        return False
    try:
        subprocess.run(
            ["/bin/cat", str(p)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=timeout, check=False,
        )
    except Exception:
        pass
    try:
        return p.stat().st_size > 0
    except OSError:
        return False


def _pdf_text_via_pypdf(p: Path) -> str:
    from pypdf import PdfReader
    try:
        reader = PdfReader(str(p))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as e:
        print(f"  pypdf failed on {p.name}: {e}")
        return ""


def _pdf_text_via_pdftotext(p: Path) -> str:
    try:
        out = subprocess.run(
            ["pdftotext", "-layout", str(p), "-"],
            capture_output=True, text=True, timeout=30, check=False,
        )
        return out.stdout
    except FileNotFoundError:
        return ""
    except Exception as e:
        print(f"  pdftotext failed on {p.name}: {e}")
        return ""


def pdf_text(p: Path) -> str:
    if not materialize(p):
        return ""
    if _HAS_PYPDF:
        return _pdf_text_via_pypdf(p)
    text = _pdf_text_via_pdftotext(p)
    if not text:
        sys.exit(
            "Could not extract PDF text. Install one of:\n"
            "  pip3 install pypdf  (or --break-system-packages)\n"
            "  brew install poppler  (provides pdftotext)"
        )
    return text


def loan_id_from_name(name: str) -> str | None:
    m = re.match(r"(\d{9})_", name)
    return m.group(1) if m else None


def date_from_name(name: str) -> tuple[int, int] | None:
    """Return (year, month) parsed from filename like
    '327891008_MonthlyBillingStatements_20250901.pdf' → (2025, 9)."""
    m = re.search(r"_(\d{4})(\d{2})\d{2}\b", name)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None


# Trimont billing-statement layout — the "Current Interest Due" line is the
# scheduled interest accrual for the upcoming payment period.
# Example: "Interest Paid USD 712,033.91  Current Interest Due USD 121,950.56"
INTEREST_PATTERNS = [
    re.compile(r"Current\s+Interest\s+Due\s+USD\s+([\d,]+\.\d{2})", re.I),
    re.compile(r"Current\s+Interest\s+Due\s*[:\$]?\s*\$?\s*([\d,]+\.\d{2})", re.I),
    # Fallbacks for other formats
    re.compile(r"Total\s+Interest\s+Due\s*[:\$]?\s*\$?\s*([\d,]+\.\d{2})", re.I),
    re.compile(r"Interest\s+Charged\s*[:\$]?\s*\$?\s*([\d,]+\.\d{2})", re.I),
]


def extract_interest(text: str) -> float | None:
    for pat in INTEREST_PATTERNS:
        m = pat.search(text)
        if m:
            try:
                return float(m.group(1).replace(",", ""))
            except ValueError:
                continue
    return None


def discover_pdfs(root: Path) -> list[Path]:
    """All 2025 PDFs whose name starts with one of the loan IDs."""
    base = root / PROP_FOLDER
    if not base.exists():
        sys.exit(f"Property folder not found: {base}")
    out: list[Path] = []
    for p in base.rglob("*.pdf"):
        loan = loan_id_from_name(p.name)
        if loan not in LOAN_GL:
            continue
        d = date_from_name(p.name)
        if not d or d[0] != YEAR:
            continue
        out.append(p)
    out.sort(key=lambda p: (date_from_name(p.name) or (0, 0), p.name))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dump", action="store_true",
                    help="Dump raw text of every discovered PDF and exit.")
    ap.add_argument("--dump-one", type=int, metavar="MONTH",
                    help="Dump raw text of one month's PDFs (1-12) and exit.")
    args = ap.parse_args()

    root = find_dropbox_root()
    print(f"✓ Dropbox root: {root}")
    pdfs = discover_pdfs(root)
    print(f"✓ Found {len(pdfs)} loan PDFs for {YEAR}\n")

    if not pdfs:
        sys.exit("No matching PDFs found.")

    # Dump-text modes
    if args.dump or args.dump_one:
        for p in pdfs:
            d = date_from_name(p.name) or (0, 0)
            if args.dump_one and d[1] != args.dump_one:
                continue
            print("=" * 78)
            print(f"FILE: {p.relative_to(root)}")
            print(f"LOAN: {loan_id_from_name(p.name)}  PERIOD: {d[0]}-{d[1]:02d}")
            print("=" * 78)
            text = pdf_text(p)
            print(text)
            print()
        return 0

    # Parse mode: extract interest per (loan, month)
    by_loan_month: dict[tuple[str, int], list[tuple[Path, float]]] = {}
    failed: list[Path] = []
    for p in pdfs:
        loan = loan_id_from_name(p.name)
        d = date_from_name(p.name)
        if not loan or not d:
            continue
        text = pdf_text(p)
        amt = extract_interest(text)
        if amt is None:
            failed.append(p)
            continue
        by_loan_month.setdefault((loan, d[1]), []).append((p, amt))

    print(f"━━━ Parse results ━━━")
    if failed:
        print(f"⚠ {len(failed)} file(s) had no parseable interest line:")
        for p in failed:
            print(f"  - {p.name}")
        print(f"  → run with --dump-one MONTH to inspect raw text")
        print()

    # If multiple PDFs for same (loan, month), pick the one with largest amount
    # (assume duplicates are revisions; the larger figure is usually the latest).
    final: dict[tuple[str, int], float] = {}
    for (loan, mo), candidates in sorted(by_loan_month.items()):
        best = max(candidates, key=lambda x: x[1])
        if len(candidates) > 1:
            print(f"  loan {loan} month {mo:02d}: {len(candidates)} files, "
                  f"using {best[0].name} (${best[1]:,.2f})")
        final[(loan, mo)] = best[1]

    # Print monthly summary
    print("\n━━━ Monthly debt service ━━━")
    print(f"{'Mo':>2}  {'7152 (1st)':>14}  {'7153 (2nd)':>14}  {'7199 total':>14}")
    yearly = {"7152": 0.0, "7153": 0.0, "7199": 0.0}
    for mo in range(1, 13):
        a = final.get(("327891008", mo), 0.0)
        b = final.get(("327891108", mo), 0.0)
        t = a + b
        yearly["7152"] += a
        yearly["7153"] += b
        yearly["7199"] += t
        print(f"{mo:>2}  {a:>14,.2f}  {b:>14,.2f}  {t:>14,.2f}")
    print("─" * 52)
    print(f"   YTD: 1st=${yearly['7152']:,.2f}  2nd=${yearly['7153']:,.2f}  "
          f"total=${yearly['7199']:,.2f}")

    if not final:
        print("\n⚠ No data parsed — nothing to write.")
        return 1

    # Emit SQL
    OUT_SQL.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "-- 61 S Paramus 2025 debt service — derived from monthly mortgage",
        "-- billing statements (loans 327891008 + 327891108).",
        "-- Generated by scripts/extract_61paramus_2025_debt.py",
        "",
        "-- Clean any prior debt-service rows for this property/year",
        f"DELETE FROM actuals_line_items",
        f" WHERE property_id = '{PROPERTY_ID}'",
        f"   AND year = {YEAR}",
        f"   AND gl_code IN ('7152','7153','7199');",
        "",
        "INSERT INTO actuals_line_items (property_id, year, gl_code, account_name, month, amount)",
        "VALUES",
    ]
    rows = []
    for loan, (gl, acct) in LOAN_GL.items():
        for mo in range(1, 13):
            amt = final.get((loan, mo))
            if amt is None:
                continue
            rows.append(f"  ('{PROPERTY_ID}', {YEAR}, '{gl}', '{acct}', {mo}, {amt:.2f})")
    for mo in range(1, 13):
        a = final.get(("327891008", mo))
        b = final.get(("327891108", mo))
        if a is None and b is None:
            continue
        total = (a or 0) + (b or 0)
        rows.append(f"  ('{PROPERTY_ID}', {YEAR}, '7199', 'TOTAL DEBT SERVICE', {mo}, {total:.2f})")
    lines.append(",\n".join(rows) + ";")
    OUT_SQL.write_text("\n".join(lines) + "\n")
    print(f"\n✓ Wrote SQL to: {OUT_SQL}")
    print(f"  Run via the admin SQL Console (admin.firstmilecap.com → SQL).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
