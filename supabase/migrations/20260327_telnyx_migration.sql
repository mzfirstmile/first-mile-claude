-- ============================================================
-- MIGRATE SMS FROM TWILIO TO TELNYX
-- Rename twilio_sid → provider_id for provider-agnostic storage
-- ============================================================

-- Rename column
ALTER TABLE sms_messages RENAME COLUMN twilio_sid TO provider_id;

-- Update index name (drop old, create new)
DROP INDEX IF EXISTS idx_sms_twilio_sid;
CREATE INDEX IF NOT EXISTS idx_sms_provider_id ON sms_messages (provider_id);
