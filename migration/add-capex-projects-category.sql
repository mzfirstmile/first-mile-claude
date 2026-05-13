-- Add category to capex_projects so Base Bldg, TI, and LC each have their
-- own collapsible group of project sub-rows on the Cash Forecast.

ALTER TABLE capex_projects
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'base_bldg';
