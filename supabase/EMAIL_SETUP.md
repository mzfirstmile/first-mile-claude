# Email Integration Setup Guide

## Overview
The AI assistant at `aiassistant@firstmilecap.com` can send, receive, and manage emails via Microsoft Graph API + Supabase Edge Functions.

---

## Step 1: Azure AD — Add Mail Permissions

1. Go to https://portal.azure.com → Azure Active Directory → App registrations
2. Select your existing app (Client ID: `3a5ad401-67c5-4632-993f-2b4051bd6bf1`)
3. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions**
4. Add these permissions:
   - `Mail.Read` — read all mailboxes (needed for inbox sync)
   - `Mail.Send` — send mail as any user (needed for sending)
   - `Mail.ReadWrite` — manage mail (needed for marking read, moving, etc.)
5. Click **Grant admin consent for First Mile Capital** (green checkmark button)

## Step 2: Azure AD — Create a Client Secret

1. In the same app registration, go to **Certificates & secrets**
2. Click **New client secret**
3. Description: `supabase-email-functions`
4. Expiry: 24 months (set a calendar reminder to rotate)
5. **Copy the secret value immediately** — you won't see it again

## Step 3: Run the Database Migration

In the Supabase SQL Editor (https://supabase.com/dashboard → your project → SQL Editor):

1. Open `supabase/migrations/20260326_create_emails.sql`
2. Paste and run it — this creates the `emails` and `email_sent_log` tables

## Step 4: Set Supabase Secrets

From your terminal (with Supabase CLI installed):

```bash
supabase secrets set AZURE_TENANT_ID=bb09c9a4-2028-4b30-bdbc-dc9c623a2398
supabase secrets set AZURE_CLIENT_ID=3a5ad401-67c5-4632-993f-2b4051bd6bf1
supabase secrets set AZURE_CLIENT_SECRET=<paste-secret-from-step-2>
supabase secrets set SUPABASE_SERVICE_KEY=<your-service-role-key>
```

The service role key is in Supabase Dashboard → Settings → API → `service_role` key (NOT the anon key).

## Step 5: Deploy Edge Functions

```bash
cd first-mile-claude
supabase functions deploy send-email
supabase functions deploy sync-inbox
```

## Step 6: Test

**Test send:**
```bash
curl -X POST 'https://qrtleqasnhbnruodlgpt.supabase.co/functions/v1/send-email' \
  -H 'Authorization: Bearer <anon-key>' \
  -H 'Content-Type: application/json' \
  -d '{"to":"mz@firstmilecap.com","subject":"Test from AI Assistant","body":"<p>Hello! This is a test email from the AI assistant.</p>"}'
```

**Test inbox sync:**
```bash
curl -X POST 'https://qrtleqasnhbnruodlgpt.supabase.co/functions/v1/sync-inbox' \
  -H 'Authorization: Bearer <anon-key>' \
  -H 'Content-Type: application/json'
```

## Step 7: Set Up Automatic Inbox Polling (Optional)

To auto-sync every 5 minutes, add a cron job via Supabase's `pg_cron` extension:

```sql
-- Enable pg_cron if not already
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Poll inbox every 5 minutes
SELECT cron.schedule(
  'sync-ai-inbox',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://qrtleqasnhbnruodlgpt.supabase.co/functions/v1/sync-inbox',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Alternatively, use an external cron service (e.g., cron-job.org) to hit the sync-inbox endpoint.

---

## Architecture

```
User (chat widget) → Claude API → tool call → Supabase Edge Function → Microsoft Graph API
                                                       ↕
                                                  Supabase DB (emails table)
```

## Files Created
- `supabase/migrations/20260326_create_emails.sql` — database tables
- `supabase/functions/send-email/index.ts` — send via Graph API
- `supabase/functions/sync-inbox/index.ts` — poll inbox & upsert to DB
- `index.html` — updated chat widget with email tools
