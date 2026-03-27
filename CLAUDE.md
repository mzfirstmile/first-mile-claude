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
- AM Partner Payouts (~$4,333/mo from FM Paramus Member account) are deductions against Asset Management Fee Income, not separate distributions — shown as "Less: AM Partner Payout" in the AM Fee drilldown
- Email auto-reply is instant via Graph webhook (email-webhook) with 5-min cron fallback (check-inbox); dedup via atomic `replied_at` lock in auto-reply function
- Graph webhook subscription (subscribe-inbox) expires every 3 days — needs daily cron renewal

## Preferences
- Morris works fast — keep things concise, skip unnecessary explanation
- Commit to git regularly; config.js is gitignored for secrets
- CLAUDE.md should be kept in git (not gitignored) so it syncs across laptops
- When testing integrations, just do it — don't over-ask for confirmation on dev/test actions
- Claude should proactively update CLAUDE.md with business logic, decisions, and context that wouldn't be obvious from reading the codebase alone — no need to ask permission each time
