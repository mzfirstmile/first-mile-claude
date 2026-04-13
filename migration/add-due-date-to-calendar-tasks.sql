-- Add due_date column for one-time tasks
ALTER TABLE calendar_tasks ADD COLUMN IF NOT EXISTS due_date DATE;

-- Comment
COMMENT ON COLUMN calendar_tasks.due_date IS 'Specific due date for one-time tasks (NULL for recurring)';
