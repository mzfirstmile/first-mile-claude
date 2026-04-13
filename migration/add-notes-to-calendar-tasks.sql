-- Add notes column for long-form task descriptions
ALTER TABLE calendar_tasks ADD COLUMN IF NOT EXISTS notes TEXT;
