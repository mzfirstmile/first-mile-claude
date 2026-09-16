// supabase/functions/auto-reply/knowledge.ts
// Curated First Mile knowledge the AI assistant may use when answering colleagues' emails.
// Keep this in sync with CLAUDE.md (source of truth). No secrets, no bank-categorization internals.
// Live data (deals, initiatives, upcoming tasks, thread context) is appended at runtime by index.ts.

export const KNOWLEDGE = `
## First Mile Capital — who we are
- Real estate investment firm, 362 Fifth Avenue, 9th Floor, New York, NY 10001. Website FirstMileCap.com. Admin portal: https://admin.firstmilecap.com (Microsoft login).
- Managing Partner: Morris Zeitouni (mz@). Executives: Richard "Ricky" Chera (rc@), Toby Yedid (ty@), Stanley Chera (src@cacq.com), Rasheq Zarif (rz@). Ehud Kupperman (ek@) is on the 67 East 161st development team. Other portal users: aalapatt@, apauluhn@, smittal@.
- Strategy: well-located office, retail and mixed-use in small affluent towns and suburban employment nodes (NJ / CT / NY metro), plus NYC retail/mixed-use, note purchases, recaps, JVs and ground-up development. We act as asset manager / property manager (Crown as PM on several assets) and take fee income (AM, PM, acquisition, development, construction-management fees).

## Portfolio (managed / invested)
- **61 S Paramus, NJ** — Class A office. Owner FM Paramus JV LLC (Managing Member FM Paramus Member LLC; investor members incl. FM Capital, FM Pref Fund II, Futene, Hua Hu, C's USA, Richard Chera, Hagireya). Closed 12/28/2023. Lender UBS (Midland servicer). AM fee 2.0% of investor capital; distributions ≥ monthly; waterfall 100% to 6% IRR → 75/25 to 8% → 60/40. Quarterly reports within 60 days (Q1–Q3), annual within 90 days, K-1s by March 31.
- **Paramus Plaza, NJ** — retail/office plaza. Owner G&I XI Paramus Plaza Holdco LLC (DRA/Crown JV); FM Plaza Manager LLC is property manager (PMA 6/28/2024): 3% of gross income, monthly reports within 10 business days, quarterly budget variance by the 15th after quarter-end, reforecast Sept 1, annual budget Oct 1, CAM reconciliation within 8 weeks of year-end, two site visits/week, 3 bids >$10K. Lender BankUnited (monthly operating statement + rent roll, quarterly package, annual budget + audited financials). Closed 6/28/2024.
- **340 Mt Kemble, Morristown NJ** — office. FM Kemble Crown JV LLC (Manager Balfin Americas, $11M capital; FMC has a profits interest converting to 10% after Balfin's return of capital). FMC AM fee 1% of capital ($110K/yr), acquisition fee 1%. Tax info within 90 days of year-end. Lender Société Générale (quarterly financials + rent roll within 45 days; annual budget/audited financials within 60/90 days). Crown is PM (3% of gross receipts). Closed 1/21/2025.
- **1700 East Putnam, Greenwich CT** — office; Crown as PM; annual budget due Nov 15; CAM reconciliation within 8 weeks of year-end. Closed 7/1/2021.
- **575 Broadway, NYC (SoHo)** — retail/mixed-use; Crown as PM; annual budget due Nov 1. Closed 8/1/2025.
- **41 Flatbush Ave, Brooklyn** — office; FMC is Asset Manager for 41 Flatbush Equity LLC (PCCP managing investor). Supervisory fee 2.5% of collections (4% once 70% occupancy + rent commencement threshold is met); incentive fee 7.5% of value above $100M at sale. Monthly reports within 30 days, quarterly within 45, annual within 120; budget by Oct 31. Notable initiative: Gimlet/Spotify lease buyout.
- **Red Bank — River Centre (331 Newman Springs Dr + 100 & 200 Schulz Dr), NJ** — 658,928 SF five-building Class A office campus. FM Paramount JV LLC: FM 70% / Paramount Realty 30%. Debt: UBS CMBS $55M @ 7.985% (matures 10/6/2028) + Webster NVA loan $34M (matures 5/10/2031). Anchor NVA Red Bank Veterinary 108,500 SF; lease-up underway (Hackensack Meridian 52K SF, etc.). Active initiative: buying out Paramount's 30% stake.
- **132-40 Metropolitan Ave, Queens** — passive 7.47% interest, closed 1/1/2026, 36,186 SF, ~$1.1M NOI. **60-18 Metropolitan Ave, Ridgewood Queens** — 20% JV interest, closed 5/10/2024, retail; owned free and clear, Carver Federal $1.95M cash-out mortgage term sheet under evaluation.
- Other: FM Pref Fund I (Solow), FM Pref Fund II (61 S Paramus), FV Oakmanor JV, ~$4M investor capital held for the Six Fields / Lifetime AZ loan.

## Active initiatives / pipeline (see portal → Active Initiatives)
- 67 East 161st St, Bronx — ground-up ~157,000 SF office/retail build-to-suit for Bronx Defenders (150K SF @ $55 NNN, 15 yrs); two-parcel land assemblage (McDonald's $9.25M + Chase $8.5M); ~$104M total cost; MJM GC, KSS architect.
- 1 & 25 Deforest Ave, Summit NJ — two-building ~287K SF Class A office campus offered by JLL (~$100M guidance).
- 650 Madison Ave — prospective recap of Vornado's 588K SF Plaza District tower.
- Webster Bank notes (9 Campus Dr Parsippany, 955 Mass Ave Cambridge, 4300 Roosevelt Commons Seattle) — note-to-own.
- 200 Greenwich Ave; Red Bank Paramount buyout; AI-Ready Spec Suite test-fit program (3D walkthrough).

## The admin portal (admin.firstmilecap.com) — modules
- **Executive Financials** — company-level P&L, balance sheet (investments, loans out, deposits, liabilities), bank transaction upload + categorization, quarterly report.
- **Property Financials & Budgeting** — per-property actuals vs budget (monthly Yardi sync), rent roll, stacking plan, re-leasing profiles, cash forecast, balance sheet, planning-year budget entry.
- **Calendars & Tasks** — ~53 recurring compliance tasks derived from PMAs, JV operating agreements and lender reporting, by team and property; automated reminder emails (day-before, past-due, escalation to Morris + Rasheq for 2+ days late). Team members can reply to a reminder email listing what they completed and the tasks get marked Done.
- **Active Initiatives** — project workspaces (activity log, milestones, team, documents, deal table) for deals and special projects; visibility is per-project membership.
- **Deal Tracking** — prospective deals emailed to aiassistant@ are logged, geocoded, matched to the nearest researched town, scored 0–100 (Tier 1 ≥ 85, Tier 2 70–84.9, Tier 3 40–69.9, Tier 4 < 40) and reported back with a Pursue / Review / Pass recommendation, portal links and an Excel export. Status workflow New → Reviewing → Pursuing → Passed / Stale. "+ Log Deal" lets you paste a deal in directly.
- **Market Research** — ~1,970 shortlisted US towns and cities (median HHI ≥ $100k; pop 4k–75k towns plus, since Sept 2026, 98 affluent places above 75k such as Newton MA, Cambridge, Arlington VA, Bellevue, Sunnyvale, Naperville, Stamford) scored across Demographics, Company Concentrations, Office Demand (LEHD payroll jobs), Transit & Access, Relation to Other Asset Classes, Governance & Barriers, Economic Activity, Education, Quality of Life — in a residential view and an office view. Includes address search with an Area Report PDF and a research chatbot.
- Manage: Properties, Users (module access), Scheduled Jobs, SQL Console (admins).

## What the AI assistant can do by email or text ((201) 549-9232)
- Answer questions about the portfolio, agreements, deadlines and the portal using the knowledge above and live data appended below.
- Log and score a prospective deal (forward the deal email). Create or update an Active Initiative when asked (Morris/Claude chat handles the heavier project setup).
- Mark calendar tasks done when you reply to a reminder email.
- Send emails on the team's behalf (from aiassistant@) when asked.
- It cannot access personal mailboxes, bank accounts, or Dropbox files outside the allow-listed folders, and it does not invent numbers — if a figure isn't in its data it will say so and offer to check with Morris.
`;
