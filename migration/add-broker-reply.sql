-- Deal Tracking: broker acknowledgement with Ricky approval (2026-10-12)
-- deal-intake drafts a "thanks for sending" note to the broker who sent the deal, emails it to Ricky
-- (cc the FM colleague who forwarded it) for approval, and only sends it to the broker once Ricky
-- replies approve/ok/send. See CLAUDE.md "Broker acknowledgement" under Deal Tracking.
ALTER TABLE deal_tracking
  ADD COLUMN IF NOT EXISTS broker_email TEXT,
  ADD COLUMN IF NOT EXISTS broker_name TEXT,
  ADD COLUMN IF NOT EXISTS broker_subject TEXT,                       -- broker's original subject (FW:/Fwd: stripped)
  ADD COLUMN IF NOT EXISTS broker_reply_draft TEXT,                   -- HTML body proposed to the broker (no signature)
  ADD COLUMN IF NOT EXISTS broker_reply_status TEXT DEFAULT 'none',   -- none | pending_request (draft stored, approval not yet emailed) | pending (awaiting Ricky) | sent | skipped (no broker email found)
  ADD COLUMN IF NOT EXISTS broker_approval_token TEXT,                -- short token embedded in the approval email subject
  ADD COLUMN IF NOT EXISTS broker_approval_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS broker_approved_by TEXT,
  ADD COLUMN IF NOT EXISTS broker_reply_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS broker_reply_log JSONB DEFAULT '[]'::jsonb; -- [{at, event, by, note}]
CREATE INDEX IF NOT EXISTS idx_deal_tracking_broker_token ON deal_tracking(broker_approval_token);
