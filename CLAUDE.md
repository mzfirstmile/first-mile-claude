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
- **Accounting:** Calendar and deadline tracking imported from Google Sheets.
- **Executive Dashboard (exec-v2.js):** PARTIALLY COMPLETE 2026-03-30. Core structure ported, module integration tested. Remaining work: complete chart rendering (SVG), implement full upload/review flow, implement pattern learning, complete investment/liability CRUD, complete transaction review panel. exec.html can remain as fallback standalone view.

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

## Pending / Known Issues
- **132-40 Metropolitan NOI not showing on balance sheet:** Property exists in exec_investments but shows $0 valuation. FB_PROP_META updated in index.html code, but live site needs git push. Also `fbGlAccounts` was null when trying to recompute budget data — GL accounts may not have loaded. Budget rows DO exist in Supabase (confirmed). **UPDATE 2026-03-30:** Budget data (2026+2027) seeded via `migration/seed-metropolitan-budget.sql`. NOI corrected to exclude RET (Real Estate Tax Recovery) pass-throughs: 2026 NOI = $1,124,216 ($93,684.70/mo), 2027 NOI = $1,390,000 ($115,833.33/mo per Morris). RET is tenant reimbursement that offsets RE Tax expense — not real income.
- **Investment contribution → auto-update contributed amount:** When linking a wire to an investment via dropdown, should also increment that investment's `contributed` field. Not yet implemented.
- **~~Investment distributions → auto-update distributed amount~~:** DONE 2026-03-30. When Investment Income transactions are linked to an investment, the `distributed` field on the balance sheet is computed dynamically by summing all linked Investment Income transactions. Updates in real time when linking/unlinking via `recomputeDistributed()`. Distributed = editable base (historical, stored in Supabase `distributed` column) + sum of linked Investment Income transactions. Base is editable via ✏️ pencil on the balance sheet card or the full edit modal.
- **Net Position line chart (quarterly snapshot):** Once quarterly books are officially closed, create a snapshot of balance sheet net position so we can build a line chart tracking net position over time (same style as the existing net income line chart). Needs a DB table for quarterly snapshots (e.g. `exec_quarterly_snapshots` with columns: quarter, year, net_position, total_assets, total_liabilities, net_income, snapshot_date).
- **~~Cash flow chart should show Net Income P&L~~:** DONE 2026-03-30. Chart now shows Net Income (P&L) — revenue bars, opex bars, cumulative net income line. Changed from cash flow which included balance sheet items.
- **Git push from sandbox not possible:** `git push` returns 403 from proxy. Morris pushes from his machine. Always commit locally and remind Morris to push.

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
- 132-40 Metropolitan Ave: 7.47% ownership, $400K contributed, ~$1.12M NOI (2026, excl RET pass-throughs), ~$1.39M NOI (2027 per Morris), 6% cap rate, $15.085M mortgage. Position value ≈ $273K = ((NOI/cap) - mortgage) × equity%. 36,186 SF.
- 60-18 Metropolitan Ave: 3,180 SF.
- 132-40 Metropolitan budget format is tenant-by-tenant (not GL summary) — parsed by aggregating income categories (Rent→4010, RET→4120, CAM→4110, Insurance Recovery→4130, W/S Recovery→4140) across all tenants, then mapping expenses to GL codes. Budget file: `data/2026 Budget/Metropolitan *.xlsx`
- Property photos stored in `assets/Property Photos/` — mapped by `PROP_PHOTOS` object in both exec-v2.js and exec.html. Shown as thumbnails on investment cards when expanded. Photos: 132-40 Metro Ave, 60-18 Metro, 61 South, 340 MK, Paramus Plaza, 1700 East Putnam, 575 Broadway.
- RET (Real Estate Tax Recovery) is a pass-through — tenants reimburse RE tax, so it offsets the expense. Exclude from NOI calculations (GL 4120). Same principle for Insurance Recovery (4130) and W/S Recovery (4140) if material.
- SQL migrations should be run via the admin website (admin.firstmilecap.com → SQL Console), NOT via Supabase dashboard directly. Claude CAN and SHOULD run SQL itself using the browser (Chrome MCP tools) — navigate to localhost:8000/#sql or admin.firstmilecap.com/#sql, paste into textarea, click Run. Do NOT ask Morris to run SQL manually.
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

## Database Schema Notes
- `exec_transactions`: main bank transaction table. Key columns: `category_override` (TEXT), `category_name` (TEXT), `investment_id` (UUID FK → exec_investments). Index: `idx_exec_txn_investment` on `investment_id`
- `exec_investments`: investment/asset tracking. Columns: id (UUID PK), name, ownership_pct, contributed, distributed, valuation, cap_rate, property_id (FK → properties), status, membership_class, committed, unreturned_capital, net_equity
- `exec_liabilities`: debt tracking. Columns: lender, related_deal, principal, currency, usd_equivalent, maturity_date
- `budget_line_items`: property budgets by GL code/month
- `properties`: property master table with Airtable record IDs as primary keys (id, property_name, current_valuation)
- `balance_sheet_items`: property-level balance sheet line items (property_id, bs_code, amount, account_section, account_name, is_header, is_total)
- Migration files in `migration/` folder — run via Supabase SQL Editor

## Preferences
- Morris works fast — keep things concise, skip unnecessary explanation
- Commit to git regularly; config.js is gitignored for secrets
- CLAUDE.md should be kept in git (not gitignored) so it syncs across laptops
- When testing integrations, just do it — don't over-ask for confirmation on dev/test actions
- Claude should proactively update CLAUDE.md with business logic, decisions, and context that wouldn't be obvious from reading the codebase alone — no need to ask permission each time
- ALL decisions, feature specs, and business logic MUST be written to CLAUDE.md immediately — don't rely on conversation memory across sessions
- Run SQL queries via the admin website's built-in tools, not the Supabase dashboard
