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
- `exec.html` — Executive dashboard view
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

## Current Work / Status
- **Email integration:** WORKING. Azure AD app registered, Graph API permissions granted (Mail.Read, Mail.Send, Mail.ReadWrite) with admin consent. Edge functions deployed. Send confirmed working 2026-03-27.
- **SMS integration:** WORKING. Telnyx send/receive deployed. Auto-reply via Claude on inbound texts + email forwarding to Morris. Deploy with `--no-verify-jwt` (Telnyx webhook has no auth header).
- **Budget system:** Batch upload system for property budgets, GL account mapping.
- **Accounting:** Calendar and deadline tracking imported from Google Sheets.
- **Executive Dashboard (exec.html):** WORKING. P&L, cash flow, balance sheet, drilldowns, category overrides, investment linking all functional. Last major update 2026-03-27.

## Pending / Known Issues
- **132-40 Metropolitan NOI not showing on balance sheet:** Property exists in exec_investments but shows $0 valuation. FB_PROP_META updated in index.html code, but live site needs git push. Also `fbGlAccounts` was null when trying to recompute budget data — GL accounts may not have loaded. Budget rows DO exist in Supabase (confirmed).
- **Investment contribution → auto-update contributed amount:** When linking a wire to an investment via dropdown, should also increment that investment's `contributed` field. Not yet implemented.
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
- exec.html defaults to Yearly view (not Monthly)
- URL hash state persistence: mode, period, drilldown type all saved to hash so page refresh keeps your view
- Browser back button closes drilldown (uses History API pushState/popstate)
- Linked investments show subtle ↗ arrow icon (not "Linked" text badge) — clicking navigates to Property Financials module via `target="_top"` (breaks out of iframe)
- PM Fee Income and Payroll rows show NET values (display only — doesn't affect totals). PM Fee shows "Gross | Less payroll" sub-note. Payroll shows "Out | In" sub-note.
- 132-40 Metropolitan Ave: 7.47% ownership, $400K contributed, ~$1.35M NOI, 6% cap rate
- SQL migrations should be run via the admin website (admin.firstmilecap.com), NOT via Supabase dashboard directly
- Category dropdown in drilldowns is grouped into sections: 💰 Income, 📋 Expenses, 📊 Balance Sheet, 🔄 Other — uses `<optgroup>` with `buildCategoryOptions()` helper
- "Investor Contribution (Pass-Through)" removed from dropdown — everything merged into "Investment Contributions"
- Loan Out / Deposit drilldown rows have inline editable name field (persists to `category_name` column) + category dropdown
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
