# First Mile Capital — AI Admin Platform

## Owner
Morris Zeitouni (mz@firstmilecap.com) — Managing Partner, First Mile Capital

## What This Is
An internal admin dashboard for First Mile Capital, a real estate investment firm. The app is hosted at admin.firstmilecap.com (GitHub Pages) and uses Supabase as the backend + Claude as an AI assistant embedded in the UI.

## Tech Stack
- **Frontend:** Single-page HTML/JS app (index.html = main admin dashboard, exec.html = executive view)
- **Backend:** Supabase (PostgreSQL + Edge Functions + Auth)
- **AI:** Claude API (Anthropic) — embedded chat widget with tool use
- **Email:** Microsoft Graph API via Supabase Edge Functions (aiassistant@firstmilecap.com)
- **SMS:** Telnyx API via Supabase Edge Functions
- **Hosting:** GitHub Pages (CNAME: admin.firstmilecap.com)
- **Auth/Identity:** Azure AD (tenant: bb09c9a4-2028-4b30-bdbc-dc9c623a2398, app: 3a5ad401-67c5-4632-993f-2b4051bd6bf1) — DO NOT put secrets here; they live in config.js which is gitignored

## Key Files
- `config.js` — API keys and secrets (gitignored, never commit)
- `index.html` — Main admin dashboard with Claude chat widget and tools
- `exec.html` — Executive dashboard view (standalone, can be opened separately)
- `exec-v2.js` — Executive dashboard native module (ported from exec.html, integrated into index.html iframe). Uses window.supaFetch/window.supaWrite from parent and window.bgtData for NOI. Called via `window.exec2Init()` when navigating to exec view in main app.
- `supabase/functions/send-email/` — Sends email via Microsoft Graph API
- `supabase/functions/sync-inbox/` — Syncs inbox from Graph API to Supabase
- `supabase/functions/send-sms/` — Sends SMS via Telnyx
- `supabase/functions/receive-sms/` — Receives inbound SMS via Telnyx webhook
- `supabase/migrations/` — Database schema (emails, SMS, etc.)
- `data/` — SQL scripts, GL mappings, budget data, accounting calendar
- `batches/` — Budget batch upload data
- `scripts/` — Utility scripts (Google Sheets push, local server)

## Supabase Project
- URL: https://qrtleqasnhbnruodlgpt.supabase.co
- Edge Functions are deployed via `supabase functions deploy <name>`

## Claude Chat Tools (in index.html)
The embedded Claude chat has access to these tools:
- **send_email** — Send email from aiassistant@firstmilecap.com (to, cc, subject, body)
- **search_emails** — Query synced emails via PostgREST or full-text search
- **sync_inbox** — Trigger inbox sync to pull latest emails from Graph API
- (Plus other tools for properties, budgets, GL accounts, etc.)

## Executive Dashboard Architecture (exec-v2.js)
- **Module:** `exec-v2.js` is a standalone IIFE that ports ALL functionality from exec.html into a native module scoped to `#exec2Root`
- **Integration:** index.html loads `<script src="exec-v2.js"></script>` and calls `window.exec2Init()` when switching to exec view
- **Supabase access:** Uses `window.supaFetch(table, query)` and `window.supaWrite(table, method, body, query)` exposed by index.html (no local Supabase config)
- **NOI data:** Reads from `window.bgtData` (populated by index.html's budget module) instead of listening for postMessage
- **CSS scoping:** All CSS selectors prefixed with `#exec2Root` to avoid conflicts with index.html styles; global CSS variables (:root) remain unscoped
- **HTML injection:** Creates full dashboard layout (except header) via innerHTML of #exec2Root element
- **Functions exported:** All dashboard functions are global (e.g., openDrilldown, updateCategory, setCfMode) and callable from onclick handlers
- **Features ported:** Categorization, period computation, drilldowns, chart rendering, balance sheet (investments/liabilities/cash), upload system, pattern learning, investment/liability CRUD, modal dialogs, toast notifications
- **Status:** Partially implemented (core architecture complete, functions stubbed for full implementation)

## Current Work / Status
- **Email integration:** WORKING. Azure AD app registered, Graph API permissions granted (Mail.Read, Mail.Send, Mail.ReadWrite) with admin consent. Edge functions deployed. Send confirmed working 2026-03-27.
- **SMS integration:** WORKING. Telnyx send/receive deployed. Auto-reply via Claude on inbound texts + email forwarding to Morris. Deploy with `--no-verify-jwt` (Telnyx webhook has no auth header).
- **Budget system:** Batch upload system for property budgets, GL account mapping.
- **Calendars & Tasks:** WORKING (renamed from "Accounting Calendar" 2026-04-13). ~53 tasks across 6 properties (PMA-derived, JV OA-derived, lender reporting). All task descriptions cite agreement section references (e.g. "per PMA §4a", "per JV OA §9.2"). Team categorization with multi-team support (comma-separated in DB). Team filter bar + property + type filters. Default filter auto-selects logged-in user's team. Task table below calendar with Recurring/One-Time toggle, inline edit/delete. Dynamic CRUD modal: cadence-first flow (Monthly/Quarterly/Annual/One-Time), multi-team chip picker, long-text description/notes field. One-time tasks have specific due dates. Annual tasks filtered by `due_month` column. Terminate action (soft-delete) + Delete action available on all tasks. Year navigation (2026, 2027+). Day overflow: tasks with day > daysInMonth render on last calendar day.
- **Task Reminder Emails:** Edge function `task-reminders` sends automated deadline emails to team members. Three modes:
  - `upcoming` — runs daily at 8 AM ET (cron `0 12 * * *`), emails team members about tasks due TOMORROW
  - `pastdue` — runs daily at 8 AM ET (cron `0 12 * * *`), emails team members about tasks that were due YESTERDAY and not marked Done
  - `escalation` — runs daily at 8 AM ET (cron `0 12 * * *`), emails Morris + Rasheq a summary of ALL tasks 2+ days past due across ALL teams. Grouped by team → property. Shows days late with color-coded urgency (2-3d yellow, 4-6d orange, 7d+ red). Scans last 30 days.
  - Recipients determined by task's team assignment → team roster from `app_users` table. One email per person (multiple tasks consolidated). Falls back to Executive team if no team members found.
  - Emails include: property, type, task description in a table. Footer tells recipients to reply to the email or use the dashboard link to mark tasks complete.
  - Edge function: `supabase/functions/task-reminders/index.ts`. Deploy: `supabase functions deploy task-reminders --no-verify-jwt`
  - pg_cron jobs: `task-reminders-upcoming`, `task-reminders-pastdue`, and `task-reminders-escalation`, all visible on Manage > Scheduled Jobs page
  - Task completion via email reply: when a team member replies to a reminder email listing completed tasks, the auto-reply system (or Claude chat) should parse and mark those tasks as Done
- **Executive Dashboard (exec-v2.js):** PRIMARY MODULE as of 2026-03-30. Renamed from "Exec Financials v2" to "Executive Financials". Old exec.html iframe hidden in sidebar (data-view="exec", display:none). Home module card links to exec2. Core features working: balance sheet, P&L, chart with hover tooltips, transaction upload, investment/liability CRUD, property photos on cards. Remaining work: complete pattern learning, complete transaction review panel.

## Quarterly Financial Report
- **What:** Quarterly email + PDF to Morris summarizing YTD financials — net position, net income, cash flow, P&L breakdown, balance sheet, investments, and narrative highlights (positives + areas to watch)
- **PDF:** Generated via `scripts/build_monthly_digest.py` using reportlab — 3 pages: executive summary + P&L, balance sheet + cash flow, footer. Named `First_Mile_Capital_Q1_2026_Report.pdf` etc.
- **Email:** Sent via send-email edge function. To: mz@firstmilecap.com, CC: rc@firstmilecap.com, ty@firstmilecap.com, src@cacq.com. Body is FULL HTML report (not just summary) — tables for KPI metrics, P&L, balance sheet, cash, investments, liabilities, cash flow, loans. PDF also attached.
- **Email format:** Morris wants the email body to be the full report embedded as HTML (like a PDF rendered in email), NOT a short summary with just highlights. Always include all tables and sections.
- **CC recipients:** send-email edge function `cc` field must be an ARRAY of strings, not comma-separated (Graph API rejects comma-separated).
- **Timing:** Run after Morris closes the books each quarter (Q1–Q4). Not on a fixed schedule — triggered manually or via scheduled task.
- **Output:** Saved to `~/First Mile Dropbox/Morris Zeitouni/FM Quarterly Reports/` (falls back to `reports/` in workspace). `reports/` is gitignored.
- **Attachment support:** send-email edge function accepts `attachments` array (each: `{name, contentType, contentBytes}` where contentBytes is base64).
- **Sent:** 2026-03-29 Q1 report sent to all 4 executives (Morris, Ricky, Toby, Stanley) with full HTML body + PDF attachment.
- **Cash note:** ~$4M in SAVINGS account is investor capital held for deployment (Six Fields/Lifetime AZ loan), NOT discretionary FM cash. Operating cash is only ~$346K. Report asterisks the $4M in both PDF and email.
- **Terminology:** Use "Total Revenue" (not "Total Income") everywhere — only "Net Income" uses the word "income". Applied to PDF, email, and exec.html dashboard.
- **NOI dependency:** Balance sheet investment valuations depend on NOI data from budget module. exec.html now waits for NOI before showing net position (no more flash of wrong -$4M number).

## Bank Transaction Upload System (CSV)
- **Upload button** in exec.html header ("📤 Upload Transactions") opens upload modal
- **CSV format:** Chase BAI2 format — columns: As Of, Currency, BankID Type, BankID, Account, Data Type, BAI Code, Description, Amount, Balance/Value Date, Customer Reference, Immediate Availability, 1 Day Float, 2+ DayFloat, Bank Reference, Text
- **Deduplication:** Checks date + amount + first 40 chars of description against existing allRecords. Also dedupes within the upload file itself. Since Morris uploads 30-day rolling views weekly, overlap is expected and handled.
- **Confidence scoring:** `categorizeWithConfidence()` wraps the existing `categorize()` function and adds confidence levels:
  - **High:** Known patterns (JUSTWORK=Payroll, CORPORATION SERV=Legal, SIGONFILE=Investment Income, NYS DTF/NJ WEB PMT=Taxes, SETTLEMENT=Owner Distributions, ACCOUNT TRANSFER=Internal Transfer, etc.) + Member account credits/debits + Management account Appfolio deposits
  - **Medium:** Auto-rule match that isn't generic
  - **Low:** Falls into generic catch-all categories (Other Income, Other Operating, Wire Payments, etc.)
- **Review screen:** Two sections — "Needs Review" (low/medium confidence, sorted by amount) at top, "High Confidence Matches" (high confidence, sorted by date) at bottom
- **Income linking dropdowns:** AM Fee, PM Fee, Dev Fee, Acquisition Fee get a **Property dropdown** to link income to specific properties. Investment Income gets an **Investment dropdown** (same as Investment Contributions). Interest Expense gets a **Liability dropdown** to link to loans.
- **These linking dropdowns also work in existing drilldowns** — not just the upload review screen
- **Pattern learning:** `exec_learned_patterns` table stores description patterns from user categorizations. Confidence and occurrence counts improve over time. On each upload confirmation, patterns are extracted from user's category choices and saved/incremented.
- **DB columns added:** `property_id TEXT` and `liability_id UUID` on exec_transactions. New table `exec_learned_patterns`.
- **CSV files stored in:** `Bank Transactions Batch Upload/` folder (gitignored)
- **Debits:** CSV shows debit amounts as positive — the upload code negates them (amount = -Math.abs(rawAmount) for Debits)
- **Account mapping:** ACCOUNT_NAME_MAP in exec.html maps account numbers to names (includes Pref Fund I: 483103381654, etc.)

## Active Initiatives Module
- **What:** Project tracking module for special projects, deal activity, and communications. Built 2026-04-15.
- **Module name:** "Active Initiatives" (sidebar + home card)
- **Files:** `initiatives.js` (external IIFE module, same pattern as exec-v2.js), view container in index.html `#view-initiatives` → `#initRoot`
- **DB Tables:** `initiatives` (main project), `initiative_members` (visibility/team), `initiative_entries` (chronological log: emails, notes, milestones, tasks, documents)
- **Visibility:** Per-project membership. Only users whose email is in `initiative_members` for a given initiative can see it. Admins (`isAdmin=true`) see all. The sidebar item is visible to all users.
- **Features:** Project cards grid with status filters (All/Active/On Hold/Completed), detail view with 3 tabs (Activity timeline, Milestones with checkboxes, Team members with roles), CRUD modals for creating/editing initiatives and adding entries/milestones/members
- **Entry types:** email (linked from inbox with from/to/cc metadata), note, milestone (with due_date + completed toggle), task (with assignee + due_date), document
- **Team roles:** owner, member, viewer — stored in `initiative_members.role`
- **Seeded test project:** "41 Flatbush — Gimlet/Spotify Lease Buyout" with 26 emails from the RC/AI thread, 3 milestones, 1 pinned note. Members: rc@ (owner), mz@ (member), aiassistant@ (member)
- **Design intent (from Morris):** When someone emails AI assistant a project question, Claude should use judgment: create a new initiative if it's a real project, add to an existing one if it's a continuation, or just reply if it's a simple question. Only email recipients (to/cc) should be added as members.
- **CRITICAL: Always reply to emails.** When Morris (or anyone) emails the AI assistant with a task like "create a new initiative", Claude MUST send a confirmation reply email acknowledging receipt, summarizing what was created, and linking to the dashboard. Never leave an email unanswered.
- **Overview tab:** Default landing when opening a project. Layout order: (1) AI Summary narrative, (2) Key deal visual/table specific to the project goal (stored as entry with `content='key_metrics'` and `metadata.type='deal_table'`), (3) compact stat chips, (4) milestones + key context side-by-side, (5) activity timeline. The deal table should reflect the core decision the project is driving toward — e.g. buyout offer scenarios for Gimlet, ask-vs-target comparison for acquisitions.
- **Access:** Module is visible to all users (no `access_initiatives` column). Data-level visibility controlled by `initiative_members` — non-admins only see initiatives they're members of.
- **`window.currentUser` exposure:** Added `Object.defineProperty` getter on `window` to expose the closure-scoped `currentUser` variable to external modules. Uses `isAdmin` (camelCase, not `is_admin`).
- **Supabase Storage:** `initiative-docs` bucket (public, full CRUD policies). Files stored at `{initiative-id-prefix}/{timestamp}_{filename}`. Public URL pattern: `https://qrtleqasnhbnruodlgpt.supabase.co/storage/v1/object/public/initiative-docs/{path}`. Upload via Docs tab drag-and-drop or API.
- **Auto-store behavior (CRITICAL):** When an email thread is forwarded to AI assistant to create an initiative, Claude MUST: (1) Create the initiative with a thoughtful summary, (2) Add all email participants as members, (3) Store any attached documents as `document` entries with Supabase Storage URLs (fetch from Graph API if possible), (4) Create a **project-specific deal table** (`content='key_metrics'`, `metadata.type='deal_table'`) that reflects the core decision the project is driving toward — NOT a generic table, (5) Add milestones with realistic due dates, (6) Reply to the email confirming everything. For the deal table, use judgment: buyout scenarios for lease negotiations, ask-vs-target for acquisitions, key terms table for vendor agreements, etc.
- **CRITICAL — Key Deal Visual must be project-specific and decision-relevant (Morris 2026-04-17):** The key_metrics deal_table at the top of the Overview page is NOT a generic info card. Claude must reason about what decision the project is driving toward and build a visual that surfaces the numbers needed to make that call. Use the full matrix format: `metadata.columns`, `metadata.rows` (2D array), optional `metadata.highlight_row` (0-indexed), and `metadata.summary_stats` (array of {value,label} chips). Example triggers:
  - **Prospective acquisition / underwriting stage** → Return sensitivity grid: rows = scenarios (Downside/Base/Upside), columns = Purchase Price, $/SF, Entry Cap, Stabilized NOI, Stab. YoC, Equity Check, Exit Value, Levered IRR, MOIC. Highlight the Base Case row.
  - **Lease buyout negotiation** → Offer scenario table: rows = offer amounts, columns = NPV savings vs. holding, remaining lease obligation, effective discount %, counterparty reaction.
  - **Vendor / construction contract** → Key terms table: scope, price, milestones, fee %, termination rights.
  - **Lease-up / leasing campaign** → Pipeline pivot: tenant × stage × SF × rent × probability.
  - Always include `summary_stats` chips for 4-5 headline numbers (NOI, debt, occupancy, anchor tenant, etc.)
- **Migration files:** `migration/create-initiatives.sql` (original schema); `migration/add-initiative-categories.sql` (2026-04-17: adds `category` column + `stale` status).
- **Categorization (added 2026-04-17):** Every initiative has a `category` column with values `prospective_investment` (a deal we may close) or `general` (default). Status CHECK extended to include `stale` (dead/passed deal). List view is grouped into 3 collapsible sections in this order: **Prospective Investments — Active**, **Prospective Investments — Stale / Not Closed** (collapsed by default), **General Initiatives**. Section filter buttons include an explicit "Stale" filter. Detail header shows a quick-action button for prospective investments: "⏸️ Mark Stale" when active, "↻ Reactivate" when stale. Category is selectable in both Create and Edit modals. When creating/importing a prospective deal (e.g. from Dropbox `1.1 Projects - Prospective`), always set `category='prospective_investment'`.
- **650 Madison Avenue initiative (added 2026-04-17):** id `b5a99b78-8970-4746-9a9c-022df6d93555`. Prospective acquisition/recap of Vornado's 650 Madison (Plaza District, 588,672 SF). $280M loan at 3.486% transferring to special servicing. 2026B NOI $26.6M (+22.6% YoY). Anchor: Ralph Lauren (204K SF, LXD 4/30/36). Members: mz/rc/ty. Deal table is a 3-scenario UW return sensitivity with Base highlighted. Source docs (UW model, 2026 budget, CF shortfall model, Moncler RCD, lease expirations) in Dropbox `1.1 Projects - Prospective/650 Madison`.
- **1 & 25 Deforest Ave initiative (added 2026-04-17):** id `b2544868-1b3e-4548-9012-cc4982cbc731`. Prospective acquisition — two-building Class A office campus in Summit, NJ totaling ~287,400 SF. Offered by JLL. FM UW v1 (4.17.2026): $100M PP ($347.96/SF), $105.1M total cost, $60M debt (60% LTV @ 6.58% fixed), $45.1M equity, 7.71% Going-In Cap, 1.84x DSCR, 12.08% Debt Yield, exit 7/31/2031 at 7.5% cap (~$87.5M), base case 20.13% Levered IRR / 2.35x MOIC / 7.88% CoC. Tenants: LBA Realty, Hurley Consulting, WEBBANK, Peapack-Gladstone, Schonfeld (w/ Galway sublease), Bouras Foundation, Centiva, Paras & Paras, JPMorgan Chase, Hillwood, Chiarello. Members: mz (owner), rc, ty, aiassistant. Deal table: 5-scenario exit-cap sensitivity (5.5%–7.5%) with Base Case (6.5%) highlighted. Milestones: Tour 4/24, UW v2 5/1, LOI 5/8, PSA 5/29, diligence 6/30, financing 8/1, close 8/15. 11 document entries reference files in Dropbox `1.1 Projects - Prospective/1 & 25 Deforest Ave Summit, NJ/` (UW xlsx, JLL OM, Argus, rent rolls, 2025 ops stmts, CAM/tax recoveries, leases, surveys, BOMA).
- **200 Greenwich Ave initiative:** id `7e9da281-b488-40d1-9f4a-6ea42b91dddf`. Re-categorized as `prospective_investment` 2026-04-17.
- **Webster Bank Notes initiative (added 2026-04-23):** Category `prospective_investment`. Note-to-own play on 3 senior mortgage notes originated by Webster Bank. Thesis: bid notes at a discount; if performing, earn discount accretion + contract rate; if default, foreclose and own the property at cost basis below replacement. **3 deals:** (1) **9 Campus Drive, Parsippany NJ** — suburban office ~200K SF, anchor Securitas 85K SF thru 8/31/2031 (53% of revenue), T12 revenue $3.08M, near-term rolls on Agadia 12,944 SF (Jan 2026) + Safety Sells 6,732 SF (Aug 2025). (2) **955 Mass Ave, Cambridge MA** — mixed-use Harvard Square adjacent, tenants Salesforce/Mathematica/Dado Tea (X4 Pharma terminated). Financial data in PDFs only — need pypdf re-scan. (3) **4300 Roosevelt Commons, Seattle WA** — two-building 229K SF campus. **Loan: $62.8M @ 2.996% fixed (with derivative), matures 12/12/2029.** 2024 NOI $7.83M, debt service $1.91M, DSCR 4.1x. 2025 lease roll risk (UW Regents 68K SF exp 1/31/25, Seattle CHOP 67K SF exp 8/31/25); Oct-24 model projects post-roll NOI $4.9M/yr (still 2.6x DSCR). Members: mz (owner), rc, ty, aiassistant. Seed SQL at `migration/seed-webster-bank-notes.sql`. Deal matrix highlights 4300 Roosevelt (only deal with confirmed loan data). **Open data needs from Webster:** UPB per note, asking price / discount, stated rate + amortization for 9 Campus and 955 Mass Ave. Scanner at `scripts/scan_prospective_deals.py` can be re-run with `pypdf` installed to extract PDF financials.
- **67 East 161st — Bronx Defenders Ground-Up Development initiative (added 2026-05-12):** id `36bcaad5-dd15-4daa-a542-102a290e62da`. Category `prospective_investment`. Ground-up office/retail development at 67 East 161st St, Bronx NY (Bronx Hub, across from Yankee Stadium / opposite Bronx County Courthouse). **Two-parcel land assemblage:** McDonald's parcel $9.25M (PSA signed 4/30/2026, subject to 120-day Warren Act notice to franchisee, ~24-mo build window) + Chase parcel $8.50M (PSA signed June 2026, closing Dec 2026, Chase relocates branch to LX site across the street) = **$17.75M land** on 20,510 SF lot at 7.65 FAR → **157,000 SF NLA** ($865/SF land basis, $113/SF buildable). **Build-to-suit anchored by Bronx Defenders:** Suite 300 = 150K SF @ $55/SF NNN, 15-yr term, RCD 12/31/2029; Suite 101 = 7K SF supermarket-grade retail @ $50/SF NNN, 10-yr (placeholder, supermarket LOI in folder). Blended $54.78/SF. **UW v5 (5.4.26) base case:** Total Project Cost $104.0M ($663 all-in basis/SF). Hard $56.9M ($381/SF MJM) + Soft $7.65M ($44/SF) + Contingency $3.2M + TI $1.89M + LC $4.61M + Dev Fee $2.71M (4%) + Cap Int $7.61M + Loan Fees $0.31M + Land/Closing $19.15M. Construction loan $67.6M @ 7.50% (65% LTC, 36-mo IO) → refi at Month 36 to permanent $98M @ 6.10% (3.60% fixed + 250 bps, 30-yr am, sized by 1.20x DSCR). Stabilized YoC 8.24%, Debt Yield 6.32%. 72-mo hold, 5.50% exit cap → Sale $155.4M ($990/SF) → **Levered IRR 19.84% / 2.03x / $41.7M profit** on ~$45.9M equity (unlevered 12.06% / 1.69x). **Sensitivity** (Levered IRR/EM, 72-mo hold): 4.50% cap 28.1%/2.84x, 5.00% 23.9%/2.40x, **5.50% 19.8%/2.03x (Base)**, 6.00% 15.7%/1.72x, 6.50% 11.4%/1.46x. **Members:** mz (owner), ek (Ehud Kupperman, member), aiassistant (member). NOT shared with rc/ty per Morris's selection on creation. **Construction:** MJM is GC; latest hard-cost budget dated 4/10/2026, prior soft-cost budget 2/13/2026. **Plans:** KSS Architecture (filename prefix 21-126); latest plan set 5/11, latest zoning presentation 3/23/2026. **Tenant negotiation status:** BXD redline response received 11/21/2025 — open economic terms in lease still in play; work letter draft on file. **Open data needs:** Bronx Defenders LOI to executed lease, Chase PSA closing confirmation, construction loan term sheet, supermarket tenant LOI execution. **Dropbox source folder:** `1.2 Projects - Diligence/161st St Chase/Bronx Defenders/` (Underwriting/, Tenant LOI/, Chase LOI/, Construction - MJM/, Plans Zoning Presentations/, Test Fit/, Tenant Work Letter/, Pre-closing Invoices/, Cost Tracking xlsx). **Methodology note:** Stabilized DSCR in model reads 0.78x — likely artifact of TRO drawdown timing (ANOI net of $8.05M tenant remaining obligation); flag for lender walkthrough before financing application.
- **Red Bank / River Centre — Paramount Partner Buyout initiative (added 2026-04-20):** id `6c7f22b5-7463-4522-9cef-6f0da74218d3`. Category `general` (existing asset, not prospective acquisition). Morris wants to buy out JV partner Paramount Realty's 30% membership / 26.25% capital contribution stake in FM Paramount JV LLC. Asset = 658,928 SF 5-building Class A office campus: 331 Newman Springs Dr + 100 & 200 Schulz Dr, Red Bank, NJ. **Capital stack:** $40M equity ($29.5M FM / $10.5M Paramount) + $88M debt (UBS CMBS $55M @ 7.985% matures 10/6/2028; Webster Bank NVA loan $34M @ SOFR+200 ~6.42% matures 5/10/2031). Distributions to Paramount to date: $0. **NOI path:** 2025 actual $10.8M → 2026 budget $10.04M → 2027 budget $12.59M (88% occ) → stabilized target $14.1M with ~56K SF remaining vacancy leased up. **Lease-up drivers:** Hackensack 52K SF (River 3 Ste 101+202, rent 1/2027 after 6 mo free from 7/2026), Paramount 15K SF (River 3 Ste 331 portion, starts 7/2026), Zipp Law 6,790 SF (River 2 Ste 310, 7/2026), Inflexion 8,863 SF (River 3 Ste 201, 3/2026), Withum 25,306 SF vacating 9/2026 needing backfill, GFI/BGC 19,428 SF at 50% rent through 4/2027. **Ownership structure:** FM Red Member LLC (Richard Chera managing, 42% promote) → 5% of FM Red JV LLC; Investor Members own 95% of FM Red JV; FM Red JV owns 70% of FM Paramount JV LLC; Paramount River Centre LLC (Maurice Zekaria via Paramount Realty Fund V LP) owns the 30%. **Strategic angles:** NJ mansion-tax asymmetry (Paramount buying us pays more because transferring >50%), 2.5% of gross fee stream capture, avoids ~4% brokerage/transfer friction on a full sale. **Sale scenarios** (per River Center Sale Scenario.xlsx): stabilized $13M NOI → gross $162.5-185.7M, net proceeds $86.75-109.96M after $88M debt + Avalon sale ($18.75M) - capex/stabilization costs ($23.25M) → Paramount 26.25% share $22.8-28.9M. **Capital events (2026 one-time):** Avalon Bay sale +$18.75M proceeds, partner loan repayments -$2M (Zekaria) -$500K (Chera). Deal table is buyout valuation matrix highlighting Stabilized Base scenario. Members: mz (owner), rc, ty, aiassistant. **Cash flow model** at Dropbox `2.1 FMC Property Management/Red Bank - 1 River Centre/First Mille Buyout - 2026/First MIle - Buyout analysis.xlsx` — 6-year projection (2026-2031) with tenant-by-tenant base rent (outline-grouped by building for collapse/expand), per-suite vacancy lease-up with market rent/free-rent/start-date modeling, recoveries as base-year PSF × occupied SF × OpEx inflation, dual-loan amort schedules with UBS refi event at 10/2028, leasing costs broken out by space (Committed/Backfills/Speculative/Capex), Avalon + partner loan section, and Year-6 exit value block. 352 formulas, 0 errors. Sheet1 (original Costs to Stabilize) preserved.

## Monthly Actuals Sync (Property Financials)
- **What:** Monthly workflow to pull property P&L actuals from Dropbox and populate Supabase `actuals_line_items`. Added 2026-04-22.
- **Script:** `scripts/sync_actuals.py`. Run on Morris's Mac (has Dropbox mount): `python3 scripts/sync_actuals.py --commit`
- **Flow:** Walks `~/First Mile Dropbox/.../2.1 FMC Property Management/<Property>/4 - Accounting/A - Month Quarter Financials/`, finds the latest `12Monthsincomestatement_pXXXXX_*.xlsx` per property, materializes it (Dropbox online-only files download on first read via macOS File Provider), parses the Yardi 12-month P&L, maps account names → GL codes, and upserts by DELETE+INSERT for (property_id, year).
- **Default year gate:** Only processes year ≥ 2026 (2025 COA uses legacy aliases and needs separate name→GL mapping). Override with `--min-year 2025` when backfilling.
- **Dry-run by default.** Add `--commit` to actually write. `--property p0000003` or `--file path/to.xlsx` for targeted runs. `--verbose` for per-line dump.
- **Property code map (Yardi pXXXXXXX → Airtable rec ID stored in DB):** p0000003 → recQX1kpeJKqIzvkU (Paramus Plaza), p0000004 → recUUsUChvL3yQ96g (340 Mount Kemble), p0000005 → **recqfxJfdqCXCLOuD** (61 S Paramus), p0000006 → recxF4R64gbb5Sowj (575 Broadway), p0000007 → recF3zFKbY4wJ4P40 (1700 East Putnam), p0000008 → **recRBRiverCentr01** (Red Bank - River Center). **CRITICAL: the DB column `property_id` stores the Airtable rec ID, NOT the Yardi `pXXX` code.** Any seed SQL or query against `rent_roll`, `releasing_profiles`, `budget_line_items`, `actuals_line_items`, etc. MUST use the Airtable rec ID. The `pXXX` codes only exist as labels inside the sync scripts' `PROPERTY_MAP` / `FOLDER_TO_PROPERTY` dicts. Canonical mapping lives at `scripts/sync_rent_rolls.py` lines 71–86. Metropolitan properties aren't in Yardi (passive); add to `PROPERTY_MAP` when they are.
- **Name overrides:** See `NAME_OVERRIDES` in the script for Yardi-name → GL-code aliases (e.g. "Property Tax" → 6512). 2026 files should use consistent COA so overrides are mostly unused, but kept as a safety net. `SKIP_PATTERNS` filter out intermediate Yardi sub-totals (e.g. "TOTAL R&M - OUTDOOR") that don't belong to our COA.
- **Dropbox Online-Only support:** Script calls `materialize_dropbox_file()` which reads a few bytes to trigger the macOS File Provider extension — pulls the file from Dropbox if it's a placeholder, then polls until size stabilizes. No manual click needed.
- **Property Financials — Summary column blending:** The '26 Actuals column on the Summary tab now blends YTD actuals + ROY budget for the active year. Column label becomes `'26 Act thru <Month> + Bgt` when partial. "Closed months" are determined by presence of non-zero values in sentinel rows (TOTAL INCOME, NOI, TOTAL BUILDING EXPENSES, TOTAL OPERATING EXPENSES). Pre-active years show pure actuals; planning years show pure budget; active year with no actuals loaded shows dashes.
- **Property Financials — Status-aware tab bar (2026-04-22, reworked 2026-05-11):** Tabs in the Property Financials detail panel change based on the selected year's status:
  - **Active year** (e.g. 2026): `Overview | P&L | Rent Roll | Stacking Plan | Cash Forecast | Balance Sheet`. Lands on Overview by default.
  - **Planning year** (e.g. 2027): `P&L | Rent Roll | Stacking Plan | Cash Forecast | Balance Sheet`. Lands on P&L.
  - **Historical year** (e.g. 2025): `P&L | Variance Story | Rent Roll | Stacking Plan | Balance Sheet`. Lands on Variance Story.
  - Tab config lives in `FB_TABS_BY_STATUS` + `FB_DEFAULT_TAB`. Rebuilt dynamically by `fbUpdateNavForYear()`. Legacy tab ids (`pl`, `summary`, `revenue`, `opex`, `capital`, `monthly`, `trend`, `drill`, `budget`, `actuals`) alias forward to the unified `pnl` tab via `FB_LEGACY_TAB_MAP` so old URL hash deep-links keep working.
- **Unified P&L Tab (2026-05-11):** Collapsed the old `P&L / Monthly Trend / Drilldown` trio (active year), the `Budget / Drilldown` pair (planning), and the lone `Actuals` tab (historical) into a single **P&L** tab with view controls and a slide-in drilldown drawer. Renderer: `fbRenderPLTab(body, p, baseProp)` in index.html near line 7198.
  - **Period toggle:** Annual / Quarterly / Monthly. Annual delegates to existing `fbRenderSummary`; Quarterly/Monthly delegate to `fbRenderMonthlyActVsBgt` (which keys off `fbMonthlyGrouping` — kept in sync with `fbPLPeriod` in both directions via `fbSetPLPeriod` and `fbSetMonthlyGrouping`).
  - **Compare chip:** Read-only label for v1 (`{yr} Blended vs Budget vs {yr-1}` on active, `{yr} Budget vs {yr-1} Actuals` on planning, `{yr} Actuals vs {yr} Budget vs {yr-1}` on historical). Column logic stays inside each renderer's status-aware code path. Hook up a real override later if needed.
  - **Row-click drilldown drawer:** Clicking any account row in the P&L table opens `#fbDrillDrawer` — slides in from the right (`min(720px, 78vw)`), backed by `#fbDrillOverlay`. Drawer wraps `fbRenderMonthlyDetail` with a Revenue / OpEx / Capital & Debt segmented switcher at the top. Clicked label is shown as a "scroll to find <b>{label}</b>" hint. Section is inferred via `fbInferDrillSection(label)` — regex on income/rent/recover/cam keywords → 'revenue'; depreciation/debt/capital/TI/LC keywords → 'capital'; everything else → 'opex'. Auto-closes on tab switch, ESC key, or overlay click. State: `fbPLPeriod`, `fbDrawerOpen`, `fbDrillSection`.
  - **Mockup file:** `mockups/pnl-tab-redesign.html` — standalone HTML preview used to design this iteration.
- **Property Financials — Overview tab (active year):** New default landing. Shows:
  - 4 KPI cards (Revenue, OpEx, NOI, Occupancy) with YTD value + variance chip + FY forecast (YTD Act + ROY Bgt) vs FY Budget. Occupancy card is stubbed pending rent-roll data source.
  - Cumulative YTD NOI chart (SVG): solid cyan actuals line through the last closed month, solid green budget line for the full year, dashed grey forecast continuation.
  - Top 5 favorable + top 5 unfavorable variance leaderboards (YTD, ranked by abs $ impact). Income lines treat over-budget as favorable; expense lines treat under-budget as favorable.
  - Closed-months indicator (12 tiny letter boxes, green if closed).
- **Property Financials — Consolidated Drilldown tab:** Replaces the 3 separate Revenue / OpEx / Capital tabs with a single `Drilldown` tab and a segmented switcher at the top. Reuses existing `fbRenderMonthlyDetail()` internals.
- **Property Financials — Variance Story tab (historical year):** Variance leaderboard (same component as Overview) plus a 3-KPI year recap card (Revenue / OpEx / NOI actuals with % vs budget).
- **Property Financials — Monthly Act vs Bgt tab:** Renamed `Monthly Trend`. Only visible for the active year. Renders GL-line rows (budget skeleton) with Actual / Budget / Var$ columns for each month (default) or each quarter (toggle). Also shows full-year total column. Respects $/PSF mode. When no actuals exist for the year, displays a banner suggesting the sync command.
- **Data load split:** `index.html` now tags `budget_line_items` rows with `_source='budget'` and `actuals_line_items` rows with `_source='actuals'`, then builds separate budget/actuals year-data sub-objects so they can coexist for the active year without double-counting. Each `bgtData[i].years[yr]` has `.budget` and `.actuals` sub-objects plus a flattened canonical shape for backward compat with other tabs.
- **Planning Year — Budget Cell Entry (2026-05-11):** In the P&L tab's Monthly view, when the selected year status is `planning`, every Reg-type GL row renders 12 editable `<input>` cells (one per month) for the Budget column. The Act and Var columns stay read-only. Quarterly view is intentionally NOT editable (multiple months combine into one cell → ambiguous for entry).
  - **What you see is what saves:** Inputs use `fbFmtFull` ($12,345) instead of the abbreviated `fbFmt` ($12.3K) so values are not lossy. Parser strips `$`, commas, whitespace.
  - **Save flow:** On blur or Enter, the handler does optimistic local-state update → `supaWrite('budget_line_items', 'DELETE', null, ?property_id&year&gl_code&month)` → `supaWrite('budget_line_items', 'POST', [...])`. If amount is 0, skips the POST (DELETE alone). On error, reverts local state and alerts.
  - **In-place totals:** After each save, `fbRecomputeBudgetTotsInPlace` walks every Tot-type row, recomputes its 12 monthly values from child Reg rows whose gl_code falls inside `_totRange = [lo, hi]`, and updates the visible cells in-place. No full re-render — focus + tab order survive across edits. Row-total cells (`.fb-bgt-row-total`) also refresh.
  - **Skeleton metadata:** The budget loader's `summaryRows.push(...)` now attaches `gl_code`, `gl_type` (Head/Tot/Reg), and `_totRange` (for Tot rows) to every row so the renderer can decide what's editable and the totals-recomputer can find children.
  - **Keyboard:** Tab moves across months (native), Enter moves down to the next editable cell in the same month (custom handler), Escape reverts the in-progress edit.
  - **Visual cues:** Editable cells get a soft cyan background tint, hover shows darker tint, focus puts a 2px accent border inset. Saving = small pulsing dot top-right; saved = green ✓ for 700ms; error = red background for 2s plus alert.
  - **Banner:** When budget-entry mode is on, a callout at the bottom of the table reminds: "Budget entry mode. Click any monthly budget cell to edit. Tab/Enter to confirm. Changes save automatically to `budget_line_items`."
  - **Access:** All authenticated dashboard users can edit (no role gate in v1). Lock down later via Supabase RLS if needed.

## Rent Roll System (2026-04-22)
- **What:** Live snapshot of tenant leases per property in Supabase `rent_roll` table. Drives the new Rent Roll tab on Property Financials + the Occupancy KPI on the Overview tab + auto-revenue-budget generation for Planning years.
- **Schema:** `migration/create-rent-roll.sql` — one row per tenant×suite with tenant name, suite, status, SF, lease dates, monthly/annual rent, rent/SF, escalation structure (type, pct, months, next bump date), recovery structure (CAM/RE tax/insurance), free rent, renewal options, notes, source_file. Indexes on property_id + (property_id, status) + (property_id, lease_end). View `rent_roll_active` filters to Current/Pending leases.
- **Sync script:** `scripts/sync_rent_rolls.py`. Same pattern as sync_actuals.py: walks Dropbox property folders (preferring `3 - Operations/`, `2 - Leasing_Marketing/`, `4 - Accounting/`), finds the latest `Rent Roll*.xlsx` / `RR*.xlsx`, materializes online-only files, parses with fuzzy header matching (see `COLUMN_ALIASES`), DELETE+INSERT upsert per property. Dry-run by default; `--commit` to write. `--property p0000003` or `--file path.xlsx` for targeted runs.
- **Rent Roll tab:** Visible on all year statuses (active/planning/historical). Shows 4 KPI cards (Occupancy, Annual Base Rent in-place, Active Leases, Expiring ≤12mo), filter chips (All/Current/Expiring/Vacant), and a wide tenant table with Tenant, Suite, Status, SF, Rent/SF, Monthly Rent, Annual Rent, Lease Start/End, Escalation, Next Bump. Rows expiring within 12 months are colored red.
- **Auto-Generate Revenue Budget (Planning year only):** Button on the Rent Roll tab for Planning years. Projects each tenant's base rent forward month-by-month across the target year, applies contractual escalations at `next_escalation_date` intervals (using `escalation_pct` + `escalation_months`), drops expiring leases to $0 (conservative), sums tenants to get monthly revenue totals, DELETE+INSERT to `budget_line_items` with gl_code='4010' (Base Rent - Contractual). Confirm dialog before destructive write. Requires page reload to see on Budget tab.
- **Overview Occupancy KPI:** Now wired to rent_roll. `fbPopulateOccupancyKPI` fetches the rent roll async (after the rest of Overview renders) and computes % = sum(active lease SF) / property SF. Cached in `fbRentRollCache` to avoid refetching.
- **Property code map:** Same mapping as sync_actuals.py (p0000003→Paramus Plaza, etc.). Metropolitan properties not in Yardi yet — add to FOLDER_TO_PROPERTY when they come online.
- **To enable:** (1) Run `migration/create-rent-roll.sql` in admin SQL Console. (2) Drop rent rolls in Dropbox property folders. (3) Run `python3 scripts/sync_rent_rolls.py --commit`. (4) Navigate to any Planning year → Rent Roll tab → click Generate Revenue Budget.
- **Period banner (2026-05-05):** Top of the Rent Roll tab now shows "Period: <Month Year>" pulled from a new `as_of_date` column on `rent_roll` (Yardi exports include an "As of Date:" header that `sync_rent_rolls.py` parses; generic-format files fall back to file mtime). Mirrors the Balance Sheet tab's period label. Shows source filename + last-synced date alongside the period. Migration: `migration/add-rent-roll-as-of.sql` (adds nullable `as_of_date DATE` + index).

## Re-Leasing Profiles (Rent Roll tab, 2026-05-05)
- **What:** Underwriting assumptions for what happens when an existing lease rolls. Each profile defines a "new lease" path (don't renew, re-let to a new tenant) and a "renewal" path (existing tenant stays), with a renewal probability that drives a probability-weighted **blended** value for each assumption. Used to feed lease-up modeling into the rent-roll-driven revenue budget and (eventually) the cash forecast.
- **Schema:** `migration/create-releasing-profiles.sql` — table `releasing_profiles` with columns: `property_id`, `name`, `is_default`, `renewal_probability_pct` (0–100), `base_rent_psf` (single value, no new/renew split), then `new_*` and `renew_*` pairs for each of `downtime_months`, `free_rent_months`, `escalation_pct`, `ti_psf`, `lc_pct`. Unique partial index `uq_releasing_profiles_default` enforces at most one default profile per property.
- **Field semantics:**
  - `downtime_months` = months the suite sits vacant after the prior lease ends, before the new tenant takes occupancy.
  - `free_rent_months` = months tenant occupies but pays $0 (concession period).
  - `escalation_pct` = annual contractual rent bump.
  - `ti_psf` = Tenant Improvement allowance, capex paid at lease commencement (= ti_psf × suite SF).
  - `lc_pct` = Leasing Commission, % of the **full deal rent (base rent × term length)** paid at signing. Both new and renewal columns supported.
- **Blending math (computed in UI, not stored):** `blended = (renewal_pct/100) × renew_<x> + (1 − renewal_pct/100) × new_<x>` for each of the 5 levers. Base rent has no blend (single value). Empty inputs treated as 0 in blend so partial profiles still compute.
- **UI — profile cards & modal:** Section at the bottom of the Rent Roll tab shows profile cards with name, renewal probability, base rent chip, and a 4-column mini-table (Assumption · New · Renewal · Blended). "+ New Profile" button opens a modal with three-column input grid (New Lease · Renewal · Blended) — Blended cells update **live** as you type via `fbRecalcBlended()`. Save / Edit / Delete CRUD via `supaWrite` against `releasing_profiles`. Cache: `fbReleasingProfilesCache[propId]`.
- **Per-tenant assignment (2026-05-05):** Each row in the rent-roll table now has a "Re-Leasing Profile" `<select>` cell at the right edge. Selecting a profile sets `rent_roll.releasing_profile_id` (PATCH via `fbSetTenantProfile`). Migration: `migration/add-rent-roll-profile.sql` (adds nullable `releasing_profile_id UUID` + index).
- **Projection in `fbAutoBuildRevenueBudget`:** When a tenant has a profile assigned, the auto-generated revenue budget no longer drops to $0 at `lease_end`. Instead it: (1) holds $0 for `Math.ceil(blended downtime)` months of vacancy, (2) holds $0 for `Math.ceil(blended free rent)` months of free rent, (3) resumes at `base_rent_psf × sf / 12` per month, (4) compounds blended `escalation_pct` annually thereafter. Tenants without a profile keep the conservative $0-after-lease-end behavior.
- **Default profile:** When `is_default=true` is set in the modal, the save handler first PATCHes any other rows for the same property to `is_default=false` to satisfy the unique partial index, then writes the new/edited row.
- **To enable:** Run `migration/create-releasing-profiles.sql` then `migration/add-rent-roll-profile.sql` in the SQL Console. The Rent Roll tab silently shows a "table not found" hint and hides the dropdown column until both migrations run.
- **Future hook:** Cash Forecast assumptions panel should pull the assigned-or-default re-leasing profile to model lease rollover (TI/LC capex events at lease commencement, vacancy-driven NOI dip during downtime). Not wired yet.
- **Straight Renewal profile (auto-seeded, 2026-05-11):** Every property automatically gets a "Straight Renewal" profile — the antenna / rooftop / storage / parking pattern where the tenant just keeps going at LXD at the same rent with no downtime, no free rent, no TI, no LC, and no escalation bump. Settings: `renewal_probability_pct=100`, `base_rent_psf=NULL` (so the projection carries forward each tenant's current rate — works for both PSF leases and flat-monthly antenna leases via the new `monthly_rent` fallback in `profileToProjection`), every new/renew lever = 0. Card shows a green "STRAIGHT RENEWAL" badge. Auto-creation: when a property's Rent Roll tab loads, if no profile named "Straight Renewal" exists for that property, one is POSTed silently in the background and added to the local cache. Backfill SQL for existing properties: `migration/seed-straight-renewal-profiles.sql` (idempotent — only inserts where missing, safe to re-run). `profileToProjection` was extended so that when a profile has NULL `base_rent_psf` AND the tenant has no SF (antenna leases), it falls back to `r.monthly_rent` directly — so $7,250/mo flat antenna rent keeps billing $7,250/mo after rollover instead of dropping to $0.
- **Per-tenant override values (2026-05-11):** The rent-roll table now exposes 11 inline-editable cells to the right of the Re-Leasing Profile dropdown, letting Morris override any of the profile inputs for a specific tenant: Base Rent ($/SF), Downtime (New/Renew, months), Free Rent (New/Renew, months), Escalation (New/Renew, %/yr), TI (New/Renew, $/SF), LC (New/Renew, %). Each cell shows the tenant's override if set; otherwise it shows the assigned profile's value as a placeholder. Empty input reverts to the profile. Two-row table header groups the 11 columns under a "Re-Leasing Override Values — blank cells inherit from profile" super-header. Migration: `migration/add-rent-roll-overrides.sql` adds 11 nullable columns (`rl_base_rent_psf`, `rl_new_downtime_months`, `rl_renew_downtime_months`, `rl_new_free_rent_months`, `rl_renew_free_rent_months`, `rl_new_escalation_pct`, `rl_renew_escalation_pct`, `rl_new_ti_psf`, `rl_renew_ti_psf`, `rl_new_lc_pct`, `rl_renew_lc_pct`) to `rent_roll`. Persist handler: `fbSetTenantOverride(rentRollId, col, rawValue)` — whitelisted column name, coerces empty → null, PATCHes `rent_roll`, patches local cache in place. `profileToProjection` was refactored to resolve each lever via `ov(rlKey, prKey)` → tenant override wins, profile is fallback. Renaming/clearing an override re-fetches the profile value at projection time.
- **Stacking Plan tab (2026-05-11):** New tab on Property Financials (between Rent Roll and Cash Forecast on Active/Planning, after Rent Roll on Historical). Floor-by-floor visualization of the rent roll. Each floor is one row; tenant blocks are sized proportionally to leased SF as a share of their floor's total. Floors are inferred from suite numbers — `fbInferFloor(suite)` returns the first digit of a numeric suite (e.g. 460A → F4), or maps ROOF* → Roof row, PARK/BOX/SHACK/SIGN/KIOSK → Ground row. Sort order: Roof at top, then F5→F1 descending, then Ground, then Other. Blocks colored by category (office / telecom / parking-license) and given a 2px red border when expiring < 12 months from today, 2px amber for 12–24 months. Hover tooltip shows full tenant name + SF + exact expiration date + monthly rent. Footnote calls out building SF that isn't accounted for in the rent roll. Renderer: `fbRenderStackingPlan(body, p, baseProp)` near line 5101. Reuses `fbRentRollCache` so the plan stays in sync with whatever the user sees on the Rent Roll tab.
- **Sync preserves user overlays (2026-05-11, CRITICAL fix):** `sync_rent_rolls.py` historically did DELETE+INSERT per property, which silently nuked every per-tenant `releasing_profile_id` and `rl_*` override value on each re-sync. (Found this after Morris reported losing all his 61 Paramus profile assignments.) `supabase_upsert()` now snapshots `USER_OVERRIDE_COLUMNS = (releasing_profile_id, rl_base_rent_psf, rl_new/renew_downtime_months, rl_new/renew_free_rent_months, rl_new/renew_escalation_pct, rl_new/renew_ti_psf, rl_new/renew_lc_pct)` keyed by `(tenant_name, suite)` BEFORE the DELETE, then PATCHes the overlay values back onto the matching new rows AFTER the INSERT. Includes a row-match verification using `Prefer: count=exact` + `Content-Range` so renamed tenants surface as a "skipped: tenant=… suite=… — likely renamed in Yardi" warning rather than silently dropping. Falls back gracefully to snapshotting just `releasing_profile_id` if the `rl_*` migration hasn't been run. **Restoration done 2026-05-11:** 32/32 61 Paramus tenants re-assigned via SQL Console (Straight Renewal for ROOF/BOX/PARKING, UBS/MS Renewal for those tenants, > 25K SF / > 5K SF / < 5K SF by SF band).

## Cash Forecast (Property Financials, 2026-04-22)
- **What:** New `Cash Forecast` tab on Property Financials for Active + Planning years. 12-month rolling forecast of operating cash balance + reserve balance. Added 2026-04-22.
- **Tab placement:** Between Rent Roll and Balance Sheet on Active and Planning year tab bars. Not shown on Historical.
- **Layout:** (1) 4 KPI cards — Property Cash Today · 12-Mo Projected End Cash · Lowest Operating Cash (+ when) · Reserve Balance (12-Mo). (2) SVG combo chart with monthly bars (green=operating inflow, yellow stacked=reserve draw offsetting capex, red=outflows below baseline), cyan line for cumulative operating cash, amber dashed line for reserve balance. (3) Monthly breakdown table grouped by Operating Inflows / Operating Outflows / Levered Cash Flow / Capital Events. (4) Assumptions panel showing data-source status (✓ linked / not loaded).
- **Data sources (5):**
  - `rent_roll` → Base Rent per month (with contractual escalations applied at `next_escalation_date`)
  - `budget_line_items` → Expense Recoveries (GL 41xx), Other Income (GL 45xx/47xx/48xx), Operating Expenses (GL 5xxx + 65xx)
  - `exec_liabilities` → Monthly P&I interest computed as `usd_equivalent × interest_rate / 12` (defaults to 6% if rate missing). Matched to property via `related_deal` text contains
  - `reserve_draws` → Positive amounts = draw from reserve to operating; negative amounts = deposit from operating to reserve. Drives yellow stacked segment on chart + reserve balance line
  - `cash_forecast_events` → Manual entries for TI/LC, capex, partner distributions, contributions, reserve_draw, reserve_deposit, other (new table, see migration)
  - `property_cash` → Starting operating + reserve balances (new table, see migration)
- **Schema:** `migration/create-cash-forecast.sql` creates `cash_forecast_events` (property_id, year, month, event_type, amount, description) and `property_cash` (property_id, operating_cash, reserve_cash, notes).
- **Reserve balance line (2nd series):** Amber dashed line tracks reserve balance month-by-month = starting reserve − draws + deposits. Legend updated; min-reserve threshold concept removed per Morris's call.
- **Forecast window:** Rolling 12 months starting from next month (e.g. in Apr 2026 → May 2026 through Apr 2027). Same view whether on Active or Planning year.
- **Editing:** Prompt-based editors for v1 (`fbEditPropertyCash`, `fbEditCashEvents`). v2 will have proper modals. Both invalidate `fbCashForecastCache[propId]` and re-render.
- **Computation:** `fbComputeCashForecast(baseProp, cache)` walks 12 months, applying rent-roll escalations per tenant, summing budget rows by GL prefix, computing monthly debt service, pulling draws/deposits/events by (year, month), returning `{ rows: [12 months], starting, lowest, endingCash, avgLevered }`. Render in `fbBuildCashForecastHTML`.
- **Enable steps:** (1) Run `migration/create-cash-forecast.sql` in admin SQL Console. (2) Optionally set starting cash + monthly events via the Edit buttons on the assumptions panel. (3) Navigate to any property → Cash Forecast tab. Shows warnings if inputs missing.

## Red Bank — River Center Property (added 2026-05-11)
- **What:** Added Red Bank / River Center as a managed property `recRBRiverCentr01` (Yardi code `p0000008`). 5-building Class A office campus in Red Bank NJ: 100 Schultz Dr, 200 Schultz Dr, and River Center 1/2/3 at 331 Newman Springs Dr. Total ~687,043 SF (sum of Paramount Realty's per-building PROPERTY TOTALS). Entity: FM Red Owner LLC. Owner JV: FM Paramount JV LLC (FM 70% / Paramount Realty 30%, see Red Bank initiative notes).
- **Source:** Paramount Realty monthly reporting package `_RB Report 4.26.pdf` (Apr 2026, period ending 4/30/2026) uploaded by Morris.
- **Rent roll imported:** 73 rows total — 38 occupied tenants + 35 vacant suites across the 5 buildings. Suite naming: `{building_code}-{unit}` (e.g. `rivrctr1-103`, `200schlz-101`, `100schlz-101`). Anchor tenants: NVA Red Bank Veterinary 108,500 SF @ 100schlz ($3.72M annual base), LTF Lease Co (Lifetime Fitness?) 40,212 SF @ rivrctr3 ($985K), Peraton Labs 27,635 SF @ rivrctr2 ($815K), Withum Smith & Brown 25,306 SF @ rivrctr1 ($715K), JOT Mgmt 25K @ 200schlz ($774K). Total in-place annual base rent: ~$16.3M.
- **Parser:** `outputs/parse_rb.py` walks the pdftotext output, regex-detects MM/DD/YY lease-start/end pairs, locates the 6 money tokens (base_rent, op_cam, taxes, insurance, other, total) starting at `end_date + 1` (with optional notice-date token skip). Edge case: pdftotext occasionally smushes the tenant name and SF into one token when names overflow their column (e.g. "LLC2,579" or "Mgmt108,500") — handled by splitting trailing digit run back to SF. NVA Red Bank row was hopelessly mangled by pdftotext (name + SF + deposit + dates split across 2 lines with "L" leftover); hard-coded that single tenant in `outputs/insert_rb.py`.
- **Bulk insert script:** `outputs/insert_rb.py` creates the property record + inserts all rent_roll rows via direct REST API calls. Includes the `as_of_date=2026-04-30` for the period banner. Notes column carries the original Paramount tenant code (`code=rc1onef` etc.), notice date, deposit, and other_annual values for reference.
- **Photo not yet wired:** No entry in `FB_PHOTOS` yet — falls back to no header image. Add a photo to `assets/Property Photos/red-bank-river-center.png` and add `'Red Bank - River Center': 'assets/Property%20Photos/red-bank-river-center.png'` to `FB_PHOTOS` in index.html.
- **2026 Budget imported with monthly seasonality (2026-05-11):** Replaced the prior flat-monthly import using `2026 Budget.pdf` (Crown/FM underwriting model). 13 GL codes × 12 months = 156 rows. Real-world cash timing:
  - **Income:** 4010 Base Rent ($15.336M annual, varies $1.24M-$1.34M/mo) · 4110 CAM Recovery ($1.039M, varies $78-$142K, spike in Aug) · 4700 Other Income ($53.8K, $4,485/mo flat)
  - **OpEx:** 5497 R&M ($2.190M, $151-$211K/mo) · 5602 Utilities ($1.674M, $127-$157K/mo) · 5476 Engineers Payroll ($222K, $18.5K/mo flat) · 5654 Office Supplies / catch-all for Prof Fees + G&A ($158K) · 6501 Mgmt Fee 3.5% ($575K) · 6512 Real Estate Tax ($1.245M — quarterly Feb/May/Aug/Nov) · 6523 Property Insurance ($321K — annual premium August)
  - **Below NOI:** 7152 1st Mortgage Interest / CMBS ($4.453M, $371K/mo flat) · 7101 Owner Capital Reserve / CMBS Reserves ($885K, $73.7K/mo) · 7153 2nd Mortgage Interest / NVA ($2.443M; $184K/mo Jan-Apr interest-only, then $213K/mo May-Dec amortizing per loan kicks in May 2026)
- **Reconciles to budget exactly:** Total Revenue $16.429M − Total OpEx $6.386M = NOI $10.043M, after-debt CF $2.263M. NOI margin 61.1%.
- **Actuals (Jan-Apr 2026) still bucketed under Paramount totals from the Apr-2026 report:** 28 rows in actuals_line_items. The bucketing is coarser than the budget (everything under 4010/4110/4700/5497/7064/7105/7152), so the per-line variance in the dashboard will look noisy until FM gets line-item Paramount monthly actuals. Import script for budget: `outputs/import_rb_budget_full.py`. Earlier flat-monthly import script `outputs/import_rb_pl.py` is superseded.
- **3 years of historical actuals imported (2026-05-11):** Pulled section totals from Investor Reports Q4 budget-comparison xlsx for 2023, 2024, 2025. Same Paramount → FM mapping as 2026 (4010/4110/4700/5497/7064/7105/7152). 84 rows per year × 3 years = 252 actuals_line_items. Annual ÷ 12 flat split. Year-over-year:

  | Year | Revenue | OpEx | NOI | NOI Margin | Capex/TI | Debt Service | Net Ops |
  |------|---------|------|-----|------------|----------|--------------|---------|
  | 2023 | $12.79M | $8.05M | $4.75M | 37.1% | $12.88M | $3.74M | -$12.38M |
  | 2024 | $15.46M | $6.07M | $9.40M | 60.8% | $16.27M | $7.26M | -$14.19M |
  | 2025 | $19.75M | $7.13M | $12.62M | 63.9% | $5.16M | $6.67M | $0.34M |
  | 2026 Bgt | $16.43M | $6.39M | $10.04M | 61.1% | — | $7.78M | $2.26M |

  All NOI figures reconcile to Paramount's reported NOI exactly. Heavy capex 2023-2024 was the NVA buildout + initial lease-up. 2025 termination income ($3.1M from McGraw Hill + Wells Fargo) inflates revenue; underlying recurring rent is closer to 2024 levels. **FB_YEARS extended to include 2023+2024** so the year selector + line chart now plot a 5-year trajectory (2023→2027).
- **Import script:** `outputs/import_rb_history.py` (Apr-Q4 EOY actuals from `~/First Mile Prop Dropbox/2.1 FMC Property Management/Red Bank - 1 River Centre/Investor Reports/{YYYY} Q4/`).
- **Detailed GL-level historical data NOT imported.** When First Mile wants Paramount actuals at FM-COA-line granularity, build a `paramount_gl_mapping` table.

## Pending / Known Issues
- **132-40 Metropolitan NOI not showing on balance sheet:** Property exists in exec_investments but shows $0 valuation. FB_PROP_META updated in index.html code, but live site needs git push. Also `fbGlAccounts` was null when trying to recompute budget data — GL accounts may not have loaded. Budget rows DO exist in Supabase (confirmed). **UPDATE 2026-03-30:** Budget data (2026+2027) seeded via `migration/seed-metropolitan-budget.sql`. NOI corrected to exclude RET (Real Estate Tax Recovery) pass-throughs: 2026 NOI = $1,124,216 ($93,684.70/mo), 2027 NOI = $1,390,000 ($115,833.33/mo per Morris). RET is tenant reimbursement that offsets RE Tax expense — not real income.
- **Investment contribution → auto-update contributed amount:** When linking a wire to an investment via dropdown, should also increment that investment's `contributed` field. Not yet implemented.
- **~~Investment distributions → auto-update distributed amount~~:** DONE 2026-03-30. When Investment Income transactions are linked to an investment, the `distributed` field on the balance sheet is computed dynamically by summing all linked Investment Income transactions. Updates in real time when linking/unlinking via `recomputeDistributed()`. Distributed = editable base (historical, stored in Supabase `distributed` column) + sum of linked Investment Income transactions. Base is editable via ✏️ pencil on the balance sheet card or the full edit modal.
- **Net Position line chart (quarterly snapshot):** Once quarterly books are officially closed, create a snapshot of balance sheet net position so we can build a line chart tracking net position over time (same style as the existing net income line chart). Needs a DB table for quarterly snapshots (e.g. `exec_quarterly_snapshots` with columns: quarter, year, net_position, total_assets, total_liabilities, net_income, snapshot_date).
- **~~Cash flow chart should show Net Income P&L~~:** DONE 2026-03-30. Chart now shows Net Income (P&L) — revenue bars, opex bars, cumulative net income line. Changed from cash flow which included balance sheet items. Hover tooltips show Revenue, Expenses, and cumulative Net Income per period.
- **Git push from sandbox WORKS** (as of 2026-05-11). The `remote.origin.url` carries an embedded GitHub PAT (`https://ghp_TOKEN@github.com/...`), so the sandbox can `git push origin main` directly without keychain access. Workflow: commit locally + push from the sandbox in the same session. **Caveat:** the PAT is visible in `.git/config` — rotate it periodically and replace the token in the URL with `git remote set-url origin https://NEW_TOKEN@github.com/mzfirstmile/first-mile-claude.git`. If you ever drop the token from the URL, pushes from the sandbox will start failing again — they rely on credentials being baked into the remote URL since the sandbox can't reach the macOS keychain.
- **Stale .git lock files:** the sandbox's bind-mount can't unlink `.git/HEAD.lock` / `.git/index.lock` (`Operation not permitted` even though the user owns the file). Workaround: rename them aside before git operations — `python3 -c "import os; [os.rename(f'.git/{n}', f'.git/.stale.{n}.{os.getpid()}') for n in os.listdir('.git') if n.endswith('.lock') and not n.startswith('.stale')]"`. Renaming within `.git/` works; cross-filesystem moves return `EXDEV`. Always do this once before `git add` / `commit` if you've previously hit a failed git operation in the session.

## Email Signature (include in ALL outbound emails as HTML)
```html
<p>Thank you,<br>First Mile AI Assistant</p>
<p>362 Fifth Avenue, 9th Floor<br>New York, NY 10001<br>(201) 549-9232 (text enabled)<br><a href="https://firstmilecap.com">FirstMileCap.com</a></p>
<img src="https://admin.firstmilecap.com/assets/First_Mile_Capital_Logo_RGB.png" alt="First Mile Capital" style="width:200px;margin-top:8px;">
```

## Key People
- **Morris Zeitouni** (mz@firstmilecap.com) — Managing Partner
- **Richard "Ricky" Chera** (rc@firstmilecap.com) — Executive
- **Toby Yedid** (ty@firstmilecap.com) — Executive
- **Stanley Chera** (src@cacq.com) — Executive (email on cacq.com domain)
- **Rasheq Zarif** (rz@firstmilecap.com) — Executive

## Company Info
- **Address:** 362 Fifth Avenue, 9th Floor, New York, NY 10001
- **AI Assistant Phone (Telnyx):** (201) 549-9232 (text enabled)
- **AI Assistant Email:** aiassistant@firstmilecap.com
- **Admin Dashboard:** admin.firstmilecap.com

## Business Logic & Domain Knowledge
*(Things that live in Morris's head, not in the code — add here as we learn them)*
- Payroll reimbursements are structured as deductions to the property management fee (not separate line items)
- Credits (incoming) to First Mile Management LLC account = Property Management Fee Income, even if they're account transfers. Only outgoing transfers from Management are Internal Transfers.
- ~$4M in FM Capital SAVINGS account is investor capital held for deployment (Six Fields loan for Lifetime AZ) — NOT discretionary FM cash. Will be deployed into an asset soon. Operating cash is only ~$346K across other accounts.
- ReWyre (Rasheq Zarif salary, ~$104K) is an asset on books — salary advance/investment
- Biweekly payroll reimbursement transfers (~$16,287, $20,200, $19,939, $2,011.36) between management and main accounts are categorized as "Payroll Reimbursement" — known amounts in PAYROLL_REIMB_AMOUNTS array with $5 tolerance matching
- AM Partner Payouts (~$4,333/mo from FM Paramus Member account) are deductions against Asset Management Fee Income, not separate distributions — shown as "Less: AM Partner Payout" in the AM Fee drilldown
- Email auto-reply is instant via Graph webhook (email-webhook) with 5-min cron fallback (check-inbox); dedup via atomic `replied_at` lock in auto-reply function
- Graph webhook subscription (subscribe-inbox) expires every 3 days — needs daily cron renewal
- "Deposit" category = balance sheet asset (not operating expense), tracked separately like Loan Out
- "Loan Out" category = balance sheet asset, user assigns a friendly name (e.g. "Wooster loan to Ricky") shown on balance sheet instead of bank description
- JLL CAS credits = Asset Management Fee Income (not Other Income)
- Elyse ~$20K payments = Finders Fee (expense)
- PACE payments = Marketing (expense)
- FM Red Member LLC removed from tracked accounts
- Balance sheet: Assets (green box) split into Investments (left) and Loans Out + Deposits (right); Liabilities (red box) below
- XShore payments = Contractors category (not Other Operating)
- "Acquisition Fee Income" is a separate income category (🔑 icon)
- "Contractors" is a separate expense category (🔨 icon)
- Investment Contributions (pass-through and direct) are merged into one "Investment Contributions" bucket — drilldown shows individual wires with full descriptions
- Owner Distributions, Investment Contributions, Loans Out, Deposits, and Loan Paybacks are grouped under "Balance Sheet Transactions" card (not separate sections)
- Each investment contribution wire can be linked to a specific investment via `investment_id` on `exec_transactions` — dropdown in drilldown shows all investments + "Add New" option
- When adding a new investment from the wire linking dropdown, user enters name + ownership % → creates unlinked investment on balance sheet
- exec.html defaults to Monthly view, latest month selected
- URL hash state persistence: mode, period, drilldown type all saved to hash so page refresh keeps your view
- Browser back button closes drilldown (uses History API pushState/popstate)
- Linked investments show subtle ↗ arrow icon (not "Linked" text badge) — clicking navigates to Property Financials module via `target="_top"` (breaks out of iframe)
- PM Fee Income and Payroll rows show NET values (display only — doesn't affect totals). PM Fee shows "Gross | Less payroll" sub-note. Payroll shows "Out | In" sub-note.
- 132-40 Metropolitan Ave: 7.47% ownership, $400K contributed, ~$1.12M NOI (2026, excl RET pass-throughs), ~$1.39M NOI (2027 per Morris), 6% cap rate, $15.085M mortgage. Position value ≈ $273K = ((NOI/cap) - mortgage) × equity%. 36,186 SF. Closed Jan 2026.
- 60-18 Metropolitan Ave: 20% ownership, 3,180 SF. Closed May 2024.
- 132-40 Metropolitan budget format is tenant-by-tenant (not GL summary) — parsed by aggregating income categories (Rent→4010, RET→4120, CAM→4110, Insurance Recovery→4130, W/S Recovery→4140) across all tenants, then mapping expenses to GL codes. Budget file: `data/2026 Budget/Metropolitan *.xlsx`
- Property photos stored in `assets/Property Photos/` — mapped by `PROP_PHOTOS` in exec-v2.js/exec.html (partial name match via `includes()`) and `FB_PHOTOS` in index.html (exact name match). Shown as thumbnails on investment cards when expanded and as card header images in Property Financials. Photos: 132-40 Metro Ave, 60-18 Metro, 61 South, 340 MK, Paramus Plaza, 1700 East Putnam, 575 Broadway. **IMPORTANT:** Photo paths with spaces must be URL-encoded (`Property%20Photos/132-40%20Metro%20Ave%20corner%20view.png`). When renaming a property, update FB_PHOTOS key to match (it uses exact match, not partial).
- RET (Real Estate Tax Recovery) is a pass-through — tenants reimburse RE tax, so it offsets the expense. Exclude from NOI calculations (GL 4120). Same principle for Insurance Recovery (4130) and W/S Recovery (4140) if material.
- SQL migrations should be run via the admin website (admin.firstmilecap.com → SQL Console), NOT via Supabase dashboard directly. Claude CAN and SHOULD run SQL itself using the browser (Chrome MCP tools) — navigate to localhost:8000/#sql or admin.firstmilecap.com/#sql, paste into textarea, click Run. Do NOT ask Morris to run SQL manually.
- **Direct Supabase REST access from sandbox (2026-05-18):** Morris whitelisted `qrtleqasnhbnruodlgpt.supabase.co` in the sandbox proxy, so Claude can hit Supabase REST directly via `curl` against `$SUPABASE_URL/rest/v1/rpc/exec_sql` using the anon key from `config.js`. **STOP asking Morris to paste SQL into the Console — just run it yourself.** Pattern:
  ```bash
  SUPABASE_URL="https://qrtleqasnhbnruodlgpt.supabase.co"
  SUPABASE_KEY="<anon key from config.js>"
  curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/exec_sql" \
    -H "apikey: $SUPABASE_KEY" -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -d '{"query":"SELECT ... NO trailing semicolon — the wrapper appends ) t"}'
  ```
  Same constraints as the in-app SQL Console: one SELECT per query, no trailing `;`. Multi-statement DDL/DML works via the fallback `EXECUTE` path (returns `{"success":true}` instead of rows). For multiline INSERTs and the like, build the JSON body with `python3 -c "import json,sys; print(json.dumps({'query': sys.argv[1]}))" "$SQL"` to avoid shell-quoting headaches.
- Category dropdown in drilldowns is grouped into sections: 💰 Income, 📋 Expenses, 📊 Balance Sheet, 🔄 Other — uses `<optgroup>` with `buildCategoryOptions()` helper
- "Investor Contribution (Pass-Through)" removed from dropdown — everything merged into "Investment Contributions"
- Loan Out / Deposit drilldown rows have inline editable name field (persists to `category_name` column) + category dropdown
- Loan Payback transactions link to a specific Loan Out via `category_name` (stores the loan name). Payback amount is netted against the loan on the balance sheet. Loans at $0 net are hidden.
- Same-named Loan Out transactions are consolidated into a single entry on the balance sheet (e.g. 2 Kemble FCB wires → 1 combined line)
- Loans Out have edit pencil (✏️) for inline editing of name, amount, start date, and maturity date on the balance sheet
- Loan Out has two dates: Start Date (always required, defaults to transaction date) and Maturity Date (optional). Start date affects cash flow period — loans with start date before the current period are excluded from that period's cash flow.
- `loan_start_date` column on exec_transactions — set automatically when categorizing as Loan Out, editable via balance sheet edit pencil
- Revenue section has a property/investment filter dropdown — filters income rows to show revenue for a specific property/investment
- Property/Investment linking dropdowns deduplicate by checking `propertyId` on investments (skip investments already linked to a listed property) — not by name matching
- Investment Contributions drilldown rows have: investment linking dropdown (links to `investment_id` on exec_transactions) + category dropdown
- Payroll double-counting fix: PM fee bank records are already net (not gross), so split logic only tracks `payrollSplitTotal` for display-only netting — does NOT reduce income amount
- `payrollSplits` map matches KNOWN_PAYROLL_SPLITS_BY_AMOUNT (txnAmount → splitAmount) after data loads via `matchPayrollSplits()`
- exec.html is loaded inside an iframe in index.html — links need `target="_top"` to break out
- NOI flows from index.html → exec.html iframe via `postMessage({ type: 'propertyNOI', data: noiMap })`
- Balance sheet investment valuation: `(NOI / cap_rate%) × equity%` for property-linked investments
- `FB_PROP_META` in index.html maps property IDs to names for Property Financials module
- Hash param `#financials&prop=PropertyName` auto-navigates to that property in index.html
- **Investment close dates** (in exec_investments.close_date): 1700 East Putnam 7/1/21, 61 South Paramus 12/28/23, 60-18 Metropolitan Ave 5/10/24, Paramus Plaza 6/28/24, FM 340 Kemble 1/21/25, 575 Broadway 8/1/25, 132-40 Metropolitan Ave 1/1/26. Investments sorted newest-first by close date on both exec-v2 balance sheet and Property Financials cards.
- **Property Financials cards** (fbRenderCards in index.html): show photo, close date ("Closed Mon YYYY"), Revenue/Expenses/NOI, SF, NOI/SF, Exp Ratio. Close dates fetched from exec_investments at load time. Sorted by close date (newest first).
- **CSS scoping pitfall:** index.html defines `.bs-card-title` with `border-bottom:1px solid; padding:12px 16px` for Property Financials balance sheet. Since exec-v2 renders INSIDE index.html (not iframe), these styles leak into exec-v2 investment cards. Fix: scope exec-v2 card styles under `#exec2Root` and explicitly reset `border-bottom:none; padding:0;` on `.bs-card-title`.
- **`</script>` in template literals:** NEVER put literal `</script>` inside a JS template string within a `<script>` tag — the HTML parser sees it as the closing tag and truncates the file. This was root cause of exec-v2 launch bugs.
- **exec-v2 init sequence:** `_injectCSS()` → `_injectHTML()` → `_initNOI()` → `initDashboard()`. All must happen in this order. Auto-init at bottom of IIFE detects if view is already active when script loads (handles script-load-after-switchView race).
- **1700 East Putnam and 575 Broadway** were added to exec_investments on 2026-03-30 (previously only in properties table, not tracked as investments). Both have ownership_pct=0 and valuation=0 — Morris needs to fill in actual values.

## JV & Operating Agreement Summaries
Key terms extracted from executed agreements. Use these to answer team questions and manage calendar tasks.

### 340 Mt Kemble — FM Kemble Crown JV LLC Operating Agreement (Jan 17, 2025)
- **Parties:** Manager = Balfin Americas LLC (CEO: Martin Mane); FM Member = First Mile Capital LLC (signed by Richard Chera)
- **Structure:** Balfin is Manager + Member ($11M capital). FMC holds profits interest → converts to 10% economic interest after Balfin receives full return of capital (§2.1)
- **Asset Management Fee:** 1% of all Capital Contributions ($11M), fixed at $110K/yr (~$9,167/mo). Paid monthly in arrears, after distributions. (§3.4a)
- **Acquisition Fee:** 1% of Purchase Price to FM Member, paid at closing. (§3.4b)
- **Distributions:** No less than quarterly. Waterfall: (i) first to Balfin until full return of capital, (ii) then 90% Balfin / 10% FMC. (§5.2)
- **Reports (§9.2):** Manager delivers to Members upon request: (a) quarterly unaudited revenue/expense statements + Members' capital; (b) additional quarterly reports as reasonably requested
- **Tax Info (§9.3):** Manager delivers tax info within 90 days after fiscal year-end (by ~March 31). If unable, deliver preliminary estimated info within that period.
- **Fiscal Year:** Calendar year (§1.7u)
- **Major Decisions requiring FMC consent (§3.3):** Amending certificate, issuing interests, bankruptcy, incurring debt, tax elections, acquisitions, admitting members, distributions, amending OA, affiliate payments
- **No leverage** without unanimous consent of Members (§2.7)
- **Transfers:** Balfin may sell interest upon notice to FMC (no ROFR) (§11.1)
- **Governing Law:** Delaware (§14.7)
- **Dispute Resolution:** Binding arbitration, AAA rules, NY or other mutually agreed location (§14.17)

### 61 S Paramus — FM Paramus JV LLC Operating Agreement (Nov 15, 2023)
- **Parties:** Managing Member = FM Paramus Member LLC; Investor Members = multiple (FM Capital, FM Pref Fund II, Futene/Hiroshi Tomashima, Hua Hu, C's USA/Richard Adler, Richard Chera, Hagireya/Yusuke Umeda)
- **Asset Management Fee:** 2.0% per annum of weighted average daily balance of Investor Members' Capital Contributions. Calculated quarterly. (§4.2)
- **Distributions:** All Available Cash distributed no less than monthly. Waterfall: (i) 100% pro rata until 6% IRR; (ii) 75/25 (Members/Manager) until 8% IRR; (iii) 60/40 thereafter. (§8.1, §8.2)
- **Tax Distributions:** Manager may distribute to cover tax liabilities at max NYC individual rates (§8.4)
- **Quarterly Reports (§5.1):** Within 60 days after end of first 3 calendar quarters — unaudited balance sheet, income statement, investment summary
- **Annual Reports (§5.1):** Within 90 days after calendar year-end — annual unaudited financial statements, tax returns, current Business Plan and Budget
- **K-1 Delivery (§9.4):** On or before March 31 each year (good faith efforts)
- **Capital Calls:** Managing Member may call additional contributions; Investor Members must fund within 20 days of notice. Non-funding member loans at 8% (voluntary) or 14% (mandatory). (§6.2, §6.3)
- **Meetings (§4.3):** Called by Managing Member anytime, 3 business days' notice minimum

### Paramus Plaza — Property Management Agreement (FM Plaza Manager, dated 6/28/2024)
- **Parties:** Owner = G&I XI Paramus Plaza Holdco LLC (DRA/Crown JV); Manager = FM Plaza Manager LLC
- **Management Fee:** 3% of monthly Gross Income from space tenants. Due on 10th business day of month OR 10 biz days after report submission (whichever later). Late payment interest: 8%/yr. (§4a)
- **Construction Management Fees:** $0-50K: 5% of direct costs; >$50K: 3%; max cap 10%. (§4c)
- **Monthly Reports (Exhibit A, §2a):** Within 10 business days after month-end — executive summary, P&L, balance sheet, GL, aging, reconciliations, rent roll, delinquency, vacancy, construction status
- **Quarterly Budget Variance (Exhibit A §5):** By 15th day after quarter-end — variance explanations
- **Annual Reforecast:** Due September 1 — 7 months actual + 5 months projected
- **Annual Budget:** Due October 1 (or Owner's set date) — operating & capital budgets
- **Year-end CAM Reconciliation:** Within 8 weeks after year-end close (§2a-iii)
- **Insurance:** Annual certificate review (§7f); Manager liability: $2M/occurrence, $3M aggregate
- **Property Visits:** Minimum twice per week (§2a-i)
- **Expense Submission:** Asset Manager submits itemized costs by 10th of each month; Owner reviews/funds by 15th (§3.7a-i)
- **Vendor Bids:** 3 qualified bids required for work >$10K; Owner pre-approval for contracts >$10K (§2a-vii, §2a-viii)
- **DRA JV Agreement files:** Corrupted/0 bytes in Dropbox — need executed copies

### Paramus Plaza — FM Plaza JV LLC Operating Agreement
- **Structure:** FM Plaza Manager LLC is Managing Member
- **Distributions (§5.01):** Pro rata by Percentage Interests; amount/timing at Managing Member discretion; sufficient to cover tax obligations
- **Tax (§9):** Partnership treatment; Managing Member is tax matters representative
- **Meetings (§2.07):** 10-60 days notice; called by Managing Member or 25%+ interest holders

### 41 Flatbush — Asset Management Agreement (PCCP/Crown, July 3, 2023)
- **Parties:** Owner = 41 Flatbush Equity LLC (PCCP as Managing Investor); Asset Manager = First Mile Capital LLC (FMC)
- **Supervisory Fee:** 2.5% of Monthly Gross Collections (until Lease Threshold met), then 4% after threshold. Reverts to 2.5% if occupancy <65% for 6+ months. Paid monthly in arrears. Must pay within 10 days of due date. (§4.1)
- **Lease Threshold:** 70% occupancy + 70% rent commencement (Blue State Digital excluded)
- **Incentive Fee:** 7.5% of (purchase price exceeding $100M + all hard/soft costs). Due on Sale Closing Date. Pro-rated if terminated early. (§4.1)
- **Monthly Reports (Schedule 2, §3.6b):** Within 30 days after month-end — bank statements, cash receipts/disbursements, trial balance, GL, invoices, payroll docs, operating statements (incl DSCR), rent roll, delinquency, lease status, construction status, executive summary
- **Quarterly Reports (Schedule 2):** Within 45 days after end of Q1-Q3 — unaudited financials (balance sheet, income statement, sources/uses, prior year comparison, budget variance)
- **Annual Reports (Schedule 2):** Within 120 days after year-end — unaudited financials (balance sheet, income statement, sources/uses)
- **Annual Budget:** Due no later than October 31 — proposed operating budget for forthcoming year (§3.1c)
- **Monthly Expense Submission:** By 10th of each month; Owner reviews/funds by 15th (§3.7a-i)
- **Initial Term:** 18 months from July 3, 2023 (expired ~Jan 2025); then month-to-month. 30 days notice for no-cause termination. (§4.2)
- **Post-Termination:** Final reports + books within 30 days; original records within 10 days (§4.3d)

### 1700 East Putnam — PMA (Crown as PM)
- **Monthly Reports:** Collections, delinquencies, vacancies, budget variances, receivables/payables to FMC
- **Annual Budget:** Due no later than November 15
- **Year-end CAM/Escalation Reconciliation:** Within 8 weeks after year-end close
- **PM Fee:** Due on 10th business day of month (or 10 biz days after report submission)
- **JV Agreements:** Empty folder in Dropbox — no JV OA on file

### 575 Broadway — PMA (Crown as PM)
- **Monthly Reports:** Cash collections & A/R (due 15th); monthly variance reports (within 15 days after month-end)
- **Annual Budget:** Due no later than November 1
- **JV Agreements:** Empty folder in Dropbox — no JV OA on file

### 340 Mt Kemble — PMA (Crown as PM)
- **Monthly Reports:** Financial statements to FMC (15th biz day) — P&L, balance sheet, cash reconciliation, A/R aging, tenant status
- **Quarterly Reports:** Comprehensive report to FMC — budget-to-actual variances, operational highlights, project updates, recommendations
- **Annual Budget:** Due 60 days before fiscal year start
- **PM Fee:** 3% of gross receipts, due by 5th of succeeding month
- **Insurance Renewal:** Annual, submit certificates to lender

### 340 Mt Kemble — SocGen Lender Reporting
- **Quarterly:** Financial statements + rent roll to SocGen (within 45 days after quarter-end)
- **Annual:** Operating budget + audited financials to SocGen (within 60/90 days after year-end)

### 61 S Paramus — UBS/Midland Lender Reporting
- **Monthly:** DSCR + operating statement to servicer (within 30 days after month-end)
- **Annual:** Budget + audited financials to UBS (within 90 days)

### Paramus Plaza — BankUnited Lender Reporting
- **Monthly:** Operating statement + rent roll to BankUnited
- **Quarterly:** Financial package to BankUnited
- **Annual:** Budget + audited financials to BankUnited

## Database Schema Notes
- `exec_transactions`: main bank transaction table. Key columns: `category_override` (TEXT), `category_name` (TEXT), `investment_id` (UUID FK → exec_investments). Index: `idx_exec_txn_investment` on `investment_id`
- `exec_investments`: investment/asset tracking. Columns: id (UUID PK), name, ownership_pct, contributed, distributed, valuation, cap_rate, property_id (FK → properties), status, membership_class, committed, unreturned_capital, net_equity, close_date (DATE)
- `exec_liabilities`: debt tracking. Columns: lender, related_deal, principal, currency, usd_equivalent, maturity_date
- `budget_line_items`: property budgets by GL code/month
- `properties`: property master table with Airtable record IDs as primary keys (id, property_name, current_valuation)
- `balance_sheet_items`: property-level balance sheet line items (property_id, bs_code, amount, account_section, account_name, is_header, is_total)
- Migration files in `migration/` folder — run via Supabase SQL Editor

## Dropbox Folder Structure (First Mile Prop Dropbox)
- **Root structure:** Numbered prefix system for organization
  - `0.1 General`, `0.2 FMC Executive` — Company-wide
  - `1.1 Projects - Prospective`, `1.2 Projects - Diligence`, `1.3 Projects - Stale` — Deal pipeline
  - `2.1 FMC Property Management` — Active managed properties
  - `2.2 Passive Investments` — Non-managed investments
  - `2.4 Crown Star (MBP)` — Specific JV
  - `3.0 Realized Investments` — Exited deals
  - `9.0 Archived Completed Projects`
  - `Crown Property Accounting`, `FM Accounting - Shared LJ` — Accounting shared folders
  - `Morris Zeitouni` — Personal folder (quarterly reports saved here)
- **Per-property folder structure** (under `2.1 FMC Property Management/{PropertyName}/`):
  - `0 - Executive` — High-level docs, board materials
  - `1 - DD, Disclosures & Closing` — Due diligence, closing docs
  - `2 - Leasing_Marketing` — Leasing activity, marketing materials
  - `3 - Operations` — Day-to-day ops, PMA agreements (`3 - Operations/B. PMA/`)
  - `4 - Accounting` — Financial records, GL mappings
  - `5 - Construction` — Cap-ex, renovation projects
  - `6 - Investors` — Investor communications, K-1s
- **Properties in 2.1:** 1700 East Putnam Greenwich, 340 Mt Kemble Morristown, 41 Flatbush, 575 Broadway, 61 S Paramus, Paramus Plaza, Red Bank - 1 River Centre
- **PMA locations:** Each property's PMA is in `3 - Operations/B. PMA/` (exception: 41 Flatbush uses `Agreement/` folder)

## Preferences
- Morris works fast — keep things concise, skip unnecessary explanation
- Commit to git regularly; config.js is gitignored for secrets
- CLAUDE.md should be kept in git (not gitignored) so it syncs across laptops
- When testing integrations, just do it — don't over-ask for confirmation on dev/test actions
- Claude should proactively update CLAUDE.md with business logic, decisions, and context that wouldn't be obvious from reading the codebase alone — no need to ask permission each time
- ALL decisions, feature specs, and business logic MUST be written to CLAUDE.md immediately — don't rely on conversation memory across sessions
- Run SQL queries via the admin website's built-in tools, not the Supabase dashboard
