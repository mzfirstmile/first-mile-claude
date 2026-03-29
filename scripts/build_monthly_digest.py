from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                 TableStyle, PageBreak, HRFlowable, Image)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.pdfgen import canvas
from reportlab.lib import colors
import os
from datetime import datetime

# Output path — save to Dropbox quarterly reports folder, fallback to workspace
DROPBOX_DIR = os.path.expanduser("~/First Mile Dropbox/Morris Zeitouni/FM Quarterly Reports")
WORKSPACE_DIR = "/sessions/charming-focused-newton/mnt/first-mile-claude/reports"
QUARTER = "Q1"
YEAR = 2026
OUTPUT_FILENAME = f"First_Mile_Capital_{QUARTER}_{YEAR}_Report.pdf"
if os.path.isdir(DROPBOX_DIR):
    OUTPUT = os.path.join(DROPBOX_DIR, OUTPUT_FILENAME)
else:
    os.makedirs(WORKSPACE_DIR, exist_ok=True)
    OUTPUT = os.path.join(WORKSPACE_DIR, OUTPUT_FILENAME)
LOGO = "/sessions/charming-focused-newton/mnt/first-mile-claude/assets/First_Mile_Capital_Logo_RGB.png"

# ─── Financial Data (captured from exec.html) ───
data = {
    "period": f"{QUARTER} {YEAR}",
    "report_date": "March 29, 2026",
    "note": "Note: March books are not yet closed. Figures reflect data through most recent bank sync.",

    # Balance Sheet (with NOI-based investment valuations)
    "net_position": 7065240,
    "total_assets": 18602599,
    "total_liabilities": 11537359,

    # Cash
    # NOTE: ~$4M in SAVINGS is held for investor (Six Fields loan for Lifetime AZ) — not discretionary FM cash
    "total_cash": 4370264,
    "investor_hold_cash": 4023898,  # SAVINGS account = investor capital pending deployment
    "operating_cash": 4370264 - 4023898,  # ~$346K actual operating cash
    "cash_accounts": [
        ("First Mile Capital SAVINGS*", 4023898),
        ("First Mile Management LLC", 163946),
        ("FIRST MILE CAPITAL LLC", 74707),
        ("FM PARAMUS MEMBER LLC", 54640),
        ("FM Kemble Member", 42621),
        ("FM Plaza Member LLC", 10454),
    ],

    # Investments (NOI/cap-rate valued where applicable)
    "investments": [
        ("61 South Paramus", 6720802),
        ("FM 340 Kemble LLC", 2944314),
        ("Lifetime Paradise Valley", 2500000),
        ("Paramus Plaza", 992372),
        ("60-18 Metropolitan", 571429),
        ("FM Pref Fund II - 61 S Paramus", 309918),
        ("132-40 Metropolitan Ave", 0),
        ("FV Oakmanor JV", 0),
    ],

    # Other Assets
    "other_assets": [
        ("ReWyre — Rasheq Zarif Salary", 104000),
    ],

    # Loans Out
    "loans_out_total": 193500,
    "loans_out": [
        ("CPTK Continental (Jan 8)", 6000),
        ("Wooster - Ricky (Jan 19)", 187500),
    ],

    # Liabilities
    "liabilities": [
        ("FM Pref Fund II", 5037359, "2.8y"),
        ("Six Fields - Oakmanor Ridgewood", 4000000, "5.0y"),
        ("Six Fields - Lifetime", 2500000, "4.3y"),
    ],

    # P&L
    "total_income": 1023009,
    "total_expenses": 1001813,
    "net_income": 21197,

    # Income Breakdown
    "income": [
        ("Development Fee Income", 240469, 23.5),
        ("Property Management Fee Income", 218494, 21.4),
        ("Asset Management Fee Income", 162245, 15.9),
        ("Investment Income", 132629, 13.0),
        ("Interest Income", 25974, 2.5),
        ("Other Income", 20000, 2.0),
    ],

    # Expense Breakdown
    "expenses": [
        ("Payroll", 404120, 30.3),  # net
        ("Finders Fee", 120000, 9.2),
        ("Interest Expense", 60890, 4.6),
        ("Legal/Corp Services", 53267, 4.0),
        ("Credit Cards", 35544, 2.7),
        ("Marketing", 28084, 2.2),
        ("Rent", 24268, 1.8),
        ("Travel", 21117, 1.6),
        ("Banking", 12199, 0.9),
        ("Software/Services", 8158, 0.6),
        ("Contractors", 5400, 0.4),
        ("Taxes", 2850, 0.2),
        ("Checks", 2717, 0.2),
    ],

    # Cash Flow / BS Transactions
    "owner_distros": -164000,
    "investment_contributions": -37500,
    "loans_out_flow": -193500,
    "cash_flow": -373800,

    # Balance Sheet Transactions
    "bs_transactions": [
        ("Owner Distributions", 164000, 2),
        ("Investment Contributions", 37500, 2),
        ("Loans Out", 193500, 2),
    ],
}

# ─── Colors ───
NAVY = HexColor("#1a2332")
ACCENT = HexColor("#007AFF")
GREEN = HexColor("#27ae60")
RED = HexColor("#e74c3c")
ORANGE = HexColor("#f39c12")
LIGHT_BG = HexColor("#f8f9fa")
BORDER = HexColor("#dee2e6")
DARK_TEXT = HexColor("#212529")
MED_TEXT = HexColor("#495057")
LIGHT_TEXT = HexColor("#6c757d")

# ─── Styles ───
styles = getSampleStyleSheet()

title_style = ParagraphStyle('CustomTitle', parent=styles['Title'],
    fontSize=24, textColor=NAVY, spaceAfter=4, fontName='Helvetica-Bold')
subtitle_style = ParagraphStyle('Subtitle', parent=styles['Normal'],
    fontSize=11, textColor=LIGHT_TEXT, spaceAfter=16)
h2_style = ParagraphStyle('H2', parent=styles['Heading2'],
    fontSize=16, textColor=NAVY, spaceBefore=18, spaceAfter=8,
    fontName='Helvetica-Bold')
h3_style = ParagraphStyle('H3', parent=styles['Heading3'],
    fontSize=13, textColor=ACCENT, spaceBefore=12, spaceAfter=6,
    fontName='Helvetica-Bold')
body_style = ParagraphStyle('Body', parent=styles['Normal'],
    fontSize=10.5, textColor=DARK_TEXT, leading=15, spaceAfter=6)
note_style = ParagraphStyle('Note', parent=styles['Normal'],
    fontSize=9, textColor=ORANGE, leading=13, spaceAfter=10,
    fontName='Helvetica-Oblique')
metric_label = ParagraphStyle('MetricLabel', parent=styles['Normal'],
    fontSize=9, textColor=LIGHT_TEXT, alignment=TA_CENTER)
metric_value = ParagraphStyle('MetricValue', parent=styles['Normal'],
    fontSize=18, textColor=NAVY, fontName='Helvetica-Bold', alignment=TA_CENTER)


def fmt(n, sign=False):
    """Format number as $X,XXX"""
    prefix = ""
    if n < 0:
        prefix = "-"
        n = abs(n)
    elif sign and n > 0:
        prefix = "+"
    return f"{prefix}${n:,.0f}"

def pct(n):
    return f"{n:.1f}%"


def build_pdf():
    doc = SimpleDocTemplate(OUTPUT, pagesize=letter,
        topMargin=0.6*inch, bottomMargin=0.6*inch,
        leftMargin=0.65*inch, rightMargin=0.65*inch)
    story = []
    page_w = letter[0] - 1.3*inch  # usable width

    # ─── HEADER ───
    if os.path.exists(LOGO):
        # Logo is 5.25:1 aspect ratio (1844x351) — preserve proportions
        logo_w = 2.2*inch
        logo_h = logo_w / 5.25
        logo = Image(LOGO, width=logo_w, height=logo_h)
        logo.hAlign = 'LEFT'
        story.append(logo)
        story.append(Spacer(1, 8))

    story.append(Paragraph("Quarterly Financial Report", title_style))
    story.append(Paragraph(f"{data['period']}  |  Generated {data['report_date']}", subtitle_style))
    story.append(Paragraph(data['note'], note_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=ACCENT, spaceAfter=14))

    # ─── EXECUTIVE SUMMARY (narrative) ───
    story.append(Paragraph("Executive Summary", h2_style))

    narrative = f"""
    First Mile Capital is tracking <b>net income of {fmt(data['net_income'])}</b> year-to-date on
    <b>{fmt(data['total_income'])}</b> in total revenue against <b>{fmt(data['total_expenses'])}</b> in
    operating expenses. The firm maintains a <b>net position of {fmt(data['net_position'])}</b>, reflecting
    total assets of {fmt(data['total_assets'])} offset by {fmt(data['total_liabilities'])} in liabilities
    (primarily fund-level and project debt).
    """
    story.append(Paragraph(narrative.strip(), body_style))
    story.append(Spacer(1, 4))

    # Highlights
    story.append(Paragraph("Key Highlights", h3_style))

    positives = f"""
    <b>Positives:</b> Net position is strong at <b>{fmt(data['net_position'])}</b>. Revenue is diversified across
    six income streams, led by Development Fee Income ({fmt(data['income'][0][1])}, {pct(data['income'][0][2])}
    of total) and PM Fee Income ({fmt(data['income'][1][1])}, {pct(data['income'][1][2])}). Portfolio investments
    are valued at {fmt(sum(i[1] for i in data['investments']))} across {len([i for i in data['investments'] if i[1] > 0])}
    active positions. Investment income contributed {fmt(data['income'][3][1])} from portfolio returns.
    """
    story.append(Paragraph(positives.strip(), body_style))

    cash_note = f"""
    <b>Cash Note:</b> Total cash on books is {fmt(data['total_cash'])}, however <b>{fmt(data['investor_hold_cash'])}</b>
    in the savings account is investor capital held for deployment (Six Fields/Lifetime AZ loan). Operating cash
    available to the firm is approximately <b>{fmt(data['operating_cash'])}</b>.
    """
    story.append(Paragraph(cash_note.strip(), body_style))

    negatives = f"""
    <b>Areas to Watch:</b> Payroll remains the largest expense at {fmt(data['expenses'][0][1])} ({pct(data['expenses'][0][2])}
    of expenses). Finders fees of {fmt(data['expenses'][1][1])} are elevated. Cash flow is negative at
    <b>{fmt(data['cash_flow'])}</b> YTD, driven by {fmt(abs(data['owner_distros']))} in owner distributions and
    {fmt(abs(data['loans_out_flow']))} in loans out (primarily the Wooster loan of $187,500). 132-40 Metropolitan Ave
    and FV Oakmanor JV still pending NOI data for valuation.
    """
    story.append(Paragraph(negatives.strip(), body_style))
    story.append(Spacer(1, 10))

    # ─── KPI CARDS ───
    story.append(Paragraph("Key Metrics", h2_style))

    def make_kpi(label, value, color=NAVY):
        return Table(
            [[Paragraph(f'<font color="{color.hexval()}" size="18"><b>{value}</b></font>', metric_value)],
             [Paragraph(label, metric_label)]],
            colWidths=[page_w/4 - 6],
            rowHeights=[32, 18],
            style=TableStyle([
                ('BACKGROUND', (0,0), (-1,-1), LIGHT_BG),
                ('ALIGN', (0,0), (-1,-1), 'CENTER'),
                ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
                ('BOX', (0,0), (-1,-1), 0.5, BORDER),
                ('TOPPADDING', (0,0), (-1,-1), 6),
                ('BOTTOMPADDING', (0,0), (-1,-1), 6),
                ('LEFTPADDING', (0,0), (-1,-1), 4),
                ('RIGHTPADDING', (0,0), (-1,-1), 4),
            ])
        )

    net_inc_color = GREEN if data['net_income'] >= 0 else RED
    net_pos_color = RED if data['net_position'] < 0 else GREEN
    cf_color = RED if data['cash_flow'] < 0 else GREEN

    kpi_row = Table(
        [[make_kpi("NET INCOME", fmt(data['net_income']), net_inc_color),
          make_kpi("TOTAL INCOME", fmt(data['total_income']), GREEN),
          make_kpi("CASH ON HAND", fmt(data['total_cash']), ACCENT),
          make_kpi("NET POSITION", fmt(data['net_position']), net_pos_color)]],
        colWidths=[page_w/4]*4,
        style=TableStyle([('VALIGN', (0,0), (-1,-1), 'TOP')])
    )
    story.append(kpi_row)
    story.append(Spacer(1, 14))

    # ─── P&L TABLE ───
    story.append(Paragraph("Profit & Loss", h2_style))

    # Income table
    story.append(Paragraph("Income", h3_style))
    inc_data = [["Category", "Amount", "% of Total"]]
    for name, amt, pctv in data['income']:
        inc_data.append([name, fmt(amt), pct(pctv)])
    inc_data.append(["TOTAL INCOME", fmt(data['total_income']), "100%"])

    inc_table = Table(inc_data, colWidths=[page_w*0.55, page_w*0.25, page_w*0.20])
    inc_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), NAVY),
        ('TEXTCOLOR', (0,0), (-1,0), white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,0), 9),
        ('FONTSIZE', (0,1), (-1,-1), 9),
        ('BACKGROUND', (0,-1), (-1,-1), HexColor("#e8f5e9")),
        ('FONTNAME', (0,-1), (-1,-1), 'Helvetica-Bold'),
        ('ALIGN', (1,0), (-1,-1), 'RIGHT'),
        ('GRID', (0,0), (-1,-1), 0.5, BORDER),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('ROWBACKGROUNDS', (0,1), (-1,-2), [white, LIGHT_BG]),
    ]))
    story.append(inc_table)
    story.append(Spacer(1, 10))

    # Expenses table
    story.append(Paragraph("Operating Expenses", h3_style))
    exp_data = [["Category", "Amount", "% of Expenses"]]
    for name, amt, pctv in data['expenses']:
        exp_data.append([name, fmt(amt), pct(pctv)])
    exp_data.append(["TOTAL EXPENSES", fmt(data['total_expenses']), "100%"])

    exp_table = Table(exp_data, colWidths=[page_w*0.55, page_w*0.25, page_w*0.20])
    exp_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), NAVY),
        ('TEXTCOLOR', (0,0), (-1,0), white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,0), 9),
        ('FONTSIZE', (0,1), (-1,-1), 9),
        ('BACKGROUND', (0,-1), (-1,-1), HexColor("#fce4ec")),
        ('FONTNAME', (0,-1), (-1,-1), 'Helvetica-Bold'),
        ('ALIGN', (1,0), (-1,-1), 'RIGHT'),
        ('GRID', (0,0), (-1,-1), 0.5, BORDER),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('ROWBACKGROUNDS', (0,1), (-1,-2), [white, LIGHT_BG]),
    ]))
    story.append(exp_table)
    story.append(Spacer(1, 8))

    # Net Income box
    ni_color = GREEN if data['net_income'] >= 0 else RED
    ni_table = Table(
        [["NET INCOME", fmt(data['net_income'])]],
        colWidths=[page_w*0.55, page_w*0.45],
        style=TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), HexColor("#e8f5e9") if data['net_income'] >= 0 else HexColor("#fce4ec")),
            ('FONTNAME', (0,0), (-1,-1), 'Helvetica-Bold'),
            ('FONTSIZE', (0,0), (-1,-1), 12),
            ('TEXTCOLOR', (0,0), (-1,-1), ni_color),
            ('ALIGN', (1,0), (1,0), 'RIGHT'),
            ('BOX', (0,0), (-1,-1), 1, ni_color),
            ('TOPPADDING', (0,0), (-1,-1), 8),
            ('BOTTOMPADDING', (0,0), (-1,-1), 8),
            ('LEFTPADDING', (0,0), (-1,-1), 10),
            ('RIGHTPADDING', (0,0), (-1,-1), 10),
        ])
    )
    story.append(ni_table)

    # ─── PAGE 2: Balance Sheet & Cash Flow ───
    story.append(PageBreak())

    story.append(Paragraph("Balance Sheet", h2_style))

    # Net Position
    np_color = RED if data['net_position'] < 0 else GREEN
    np_table = Table(
        [["NET POSITION", fmt(data['net_position'])]],
        colWidths=[page_w*0.55, page_w*0.45],
        style=TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), HexColor("#fce4ec") if data['net_position'] < 0 else HexColor("#e8f5e9")),
            ('FONTNAME', (0,0), (-1,-1), 'Helvetica-Bold'),
            ('FONTSIZE', (0,0), (-1,-1), 14),
            ('TEXTCOLOR', (0,0), (-1,-1), np_color),
            ('ALIGN', (1,0), (1,0), 'RIGHT'),
            ('BOX', (0,0), (-1,-1), 1, np_color),
            ('TOPPADDING', (0,0), (-1,-1), 10),
            ('BOTTOMPADDING', (0,0), (-1,-1), 10),
            ('LEFTPADDING', (0,0), (-1,-1), 10),
            ('RIGHTPADDING', (0,0), (-1,-1), 10),
        ])
    )
    story.append(np_table)
    story.append(Spacer(1, 10))

    # Assets / Liabilities side summary
    al_data = [
        ["TOTAL ASSETS", fmt(data['total_assets']), "TOTAL LIABILITIES", fmt(data['total_liabilities'])],
    ]
    al_table = Table(al_data, colWidths=[page_w*0.25, page_w*0.25, page_w*0.25, page_w*0.25])
    al_table.setStyle(TableStyle([
        ('FONTNAME', (0,0), (-1,-1), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 10),
        ('TEXTCOLOR', (0,0), (0,0), LIGHT_TEXT),
        ('TEXTCOLOR', (1,0), (1,0), GREEN),
        ('TEXTCOLOR', (2,0), (2,0), LIGHT_TEXT),
        ('TEXTCOLOR', (3,0), (3,0), RED),
        ('ALIGN', (1,0), (1,0), 'RIGHT'),
        ('ALIGN', (3,0), (3,0), 'RIGHT'),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(al_table)
    story.append(Spacer(1, 10))

    # Cash breakdown
    story.append(Paragraph(f"Cash Balances — {fmt(data['total_cash'])}", h3_style))
    cash_data = [["Account", "Balance"]]
    for name, bal in data['cash_accounts']:
        cash_data.append([name, fmt(bal)])
    cash_table = Table(cash_data, colWidths=[page_w*0.65, page_w*0.35])
    cash_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), NAVY),
        ('TEXTCOLOR', (0,0), (-1,0), white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 9),
        ('ALIGN', (1,0), (1,-1), 'RIGHT'),
        ('GRID', (0,0), (-1,-1), 0.5, BORDER),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [white, LIGHT_BG]),
    ]))
    story.append(cash_table)
    cash_footnote = ParagraphStyle('CashFootnote', parent=styles['Normal'],
        fontSize=8, textColor=ORANGE, leading=11, spaceAfter=4, fontName='Helvetica-Oblique')
    story.append(Paragraph(
        f"* SAVINGS account ({fmt(data['investor_hold_cash'])}) is investor capital held for deployment "
        "(Six Fields/Lifetime AZ). Operating cash: ~{fmt(data['operating_cash'])}.",
        cash_footnote
    ))
    story.append(Spacer(1, 8))

    # Other Assets
    if data.get('other_assets'):
        other_total = sum(a[1] for a in data['other_assets'])
        story.append(Paragraph(f"Other Assets — {fmt(other_total)}", h3_style))
        oa_data = [["Description", "Value"]]
        for name, val in data['other_assets']:
            oa_data.append([name, fmt(val)])
        oa_table = Table(oa_data, colWidths=[page_w*0.65, page_w*0.35])
        oa_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), NAVY),
            ('TEXTCOLOR', (0,0), (-1,0), white),
            ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('FONTSIZE', (0,0), (-1,-1), 9),
            ('ALIGN', (1,0), (1,-1), 'RIGHT'),
            ('GRID', (0,0), (-1,-1), 0.5, BORDER),
            ('TOPPADDING', (0,0), (-1,-1), 4),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
            ('LEFTPADDING', (0,0), (-1,-1), 6),
            ('RIGHTPADDING', (0,0), (-1,-1), 6),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [white, LIGHT_BG]),
        ]))
        story.append(oa_table)
        story.append(Spacer(1, 10))

    # Liabilities
    story.append(Paragraph(f"Liabilities — {fmt(data['total_liabilities'])}", h3_style))
    liab_data = [["Lender", "Principal", "Maturity"]]
    for name, amt, mat in data['liabilities']:
        liab_data.append([name, fmt(amt), mat])
    liab_table = Table(liab_data, colWidths=[page_w*0.50, page_w*0.30, page_w*0.20])
    liab_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), NAVY),
        ('TEXTCOLOR', (0,0), (-1,0), white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 9),
        ('ALIGN', (1,0), (-1,-1), 'RIGHT'),
        ('GRID', (0,0), (-1,-1), 0.5, BORDER),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [white, LIGHT_BG]),
    ]))
    story.append(liab_table)
    story.append(Spacer(1, 14))

    # Cash Flow
    story.append(Paragraph("Cash Flow (Balance Sheet Transactions)", h2_style))
    cf_data = [["Category", "Amount", "# Txns"]]
    for name, amt, cnt in data['bs_transactions']:
        cf_data.append([name, f"-{fmt(amt)}", str(cnt)])
    cf_data.append(["NET CASH FLOW", fmt(data['cash_flow']), ""])

    cf_table = Table(cf_data, colWidths=[page_w*0.50, page_w*0.30, page_w*0.20])
    cf_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), NAVY),
        ('TEXTCOLOR', (0,0), (-1,0), white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 9),
        ('BACKGROUND', (0,-1), (-1,-1), HexColor("#fce4ec")),
        ('FONTNAME', (0,-1), (-1,-1), 'Helvetica-Bold'),
        ('TEXTCOLOR', (0,-1), (-1,-1), RED),
        ('ALIGN', (1,0), (-1,-1), 'RIGHT'),
        ('GRID', (0,0), (-1,-1), 0.5, BORDER),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('ROWBACKGROUNDS', (0,1), (-1,-2), [white, LIGHT_BG]),
    ]))
    story.append(cf_table)
    story.append(Spacer(1, 14))

    # Loans Out
    story.append(Paragraph(f"Loans Outstanding — {fmt(data['loans_out_total'])}", h3_style))
    lo_data = [["Description", "Amount"]]
    for name, amt in data['loans_out']:
        lo_data.append([name, fmt(amt)])
    lo_table = Table(lo_data, colWidths=[page_w*0.65, page_w*0.35])
    lo_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), NAVY),
        ('TEXTCOLOR', (0,0), (-1,0), white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 9),
        ('ALIGN', (1,0), (1,-1), 'RIGHT'),
        ('GRID', (0,0), (-1,-1), 0.5, BORDER),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [white, LIGHT_BG]),
    ]))
    story.append(lo_table)
    story.append(Spacer(1, 20))

    # Footer
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=8))
    footer_style = ParagraphStyle('Footer', parent=styles['Normal'],
        fontSize=8, textColor=LIGHT_TEXT, alignment=TA_CENTER)
    story.append(Paragraph(
        "First Mile Capital  |  362 Fifth Avenue, 9th Floor, New York, NY 10001  |  firstmilecap.com",
        footer_style
    ))
    story.append(Paragraph(
        "This report was generated automatically by the First Mile AI Assistant. Data sourced from executive dashboard.",
        footer_style
    ))

    doc.build(story)
    print(f"PDF created: {OUTPUT}")
    print(f"File size: {os.path.getsize(OUTPUT):,} bytes")

build_pdf()
