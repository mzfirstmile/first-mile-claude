"""
Run this on your computer to push deadline data to your Google Sheet.

Requirements:
    pip install gspread google-auth

Usage:
    python push_to_sheets.py

Make sure the service account JSON key file is in the same folder,
or update the path below.
"""

import gspread
from google.oauth2.service_account import Credentials

# ── Config ──
KEY_FILE = 'first-mile-capital-23b4b719b480.json'
SHEET_ID = '1PTOuia_-Ze105sYz9pIuxkl18Yxz6AYYJYygED_X8fs'

# ── Auth ──
creds = Credentials.from_service_account_file(KEY_FILE, scopes=['https://www.googleapis.com/auth/spreadsheets'])
gc = gspread.authorize(creds)
sh = gc.open_by_key(SHEET_ID)
ws = sh.sheet1

# ── Clear & Write ──
ws.clear()

rows = [
    ['Day', 'Cadence', 'Property', 'Type', 'Task', 'Owner', 'Color'],
    [8, 'Monthly', 'Pref Fund I - Solow', 'AM Fee', 'Transfer Solow AM fees to FMC - $5,208 (BofA scheduled)', 'BofA - automatic', '#6c8cff'],
    [8, 'Monthly', '41 Flatbush Ave', 'AM Fee', 'Receive JLL Financial Package from JLL. Invoice them for AM Fee - 2.5%', 'Anthony', '#50dcb4'],
    [10, 'Monthly', 'Paramus Plaza', 'Reporting', 'Upload Monthly Management Reports to DRA', 'Anthony', '#ff8c5a'],
    [20, 'Quarterly', 'Pref Fund II - JPY', 'Investor Payment', 'Purchase JPY to Goldman Sachs. Loan from FMC if cash shortfall.', 'Anthony', '#dc78ff'],
    [20, 'Quarterly', 'Pref Fund II - JPY', 'Investor Payment', 'Send JPY to investors via Goldman Sachs', 'Anthony', '#dc78ff'],
    [20, 'Monthly', '61 S Paramus', 'AM Fee', 'Transfer distros from property to FM Paramus Member (BofA scheduled)', 'BofA - automatic', '#ffd250'],
    [21, 'Monthly', '61 S Paramus', 'AM Fee', 'Transfer AM fee split 48k to FM and 4k to Ring (BofA scheduled)', 'BofA - automatic', '#ffd250'],
    [23, 'Monthly', '61 S Paramus', 'Investor Payment', 'Send Distros via Appfolio', 'Anthony', '#ffd250'],
    [23, 'Monthly', 'Paramus Plaza', 'Investor Payment', 'Send Distros via Appfolio', 'Anthony', '#ff8c5a'],
    [23, 'Monthly', 'One River Centre', 'Investor Payment', 'Send Distros via Appfolio (*Xuan sends for now, will be transferred soon to Anthony)', 'Xuan', '#50c8ff'],
    [23, 'Monthly', '1700 East Putnam', 'Investor Payment', 'Send Distros via Appfolio (*Currently Suspended)', 'Xuan', '#ff6482'],
    [23, 'Monthly', 'Pref Fund I - Solow', 'Investor Payment', 'Send Distros via Appfolio', 'Anthony', '#6c8cff'],
    [25, 'Monthly', 'Paramus Plaza', 'AM Fee', 'Pay Paramus Plaza AM Fee, if cash distro received by DRA', 'Anthony', '#ff8c5a'],
    [25, 'Quarterly', 'ALL', 'Reporting', 'Send Asset Management Report', 'Morris', '#b4b4b4'],
]

ws.update(range_name='A1', values=rows)

# Format header
ws.format('A1:G1', {
    'textFormat': {'bold': True, 'foregroundColorStyle': {'rgbColor': {'red': 1, 'green': 1, 'blue': 1}}},
    'backgroundColor': {'red': 0.12, 'green': 0.22, 'blue': 0.39}
})
ws.columns_auto_resize(0, 7)

print(f'Done! Wrote {len(rows)-1} deadlines to your Google Sheet.')
print(f'View it at: https://docs.google.com/spreadsheets/d/{SHEET_ID}')
