-- 2026-09-16: Market Research + Deal Tracking scoring moved from 0-10 to 0-100 (one decimal).
-- Multiplies every stored score by 10. Tier bands become 85 / 70 / 40 (were 8.5 / 7.0 / 4.0).
-- GUARDED: refuses to run twice (aborts if any score is already > 10).
-- Applied to prod 2026-09-16 via exec_sql. Code deployed first (edge functions, market-research.js, deal-intake).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM market_research_scores WHERE value_numeric > 10 OR value_numeric_office > 10) THEN
    RAISE EXCEPTION 'scores already appear to be on the 0-100 scale — aborting rescale';
  END IF;

  INSERT INTO market_research_rank_snapshots (label, market_id, score, tier, office_score, office_tier, rank_residential, rank_office)
  SELECT '2026-09-16 pre 0-100 rescale (0-10 values)', id, score, tier, office_score, office_tier, rank_residential, rank_office
  FROM market_research_markets WHERE phase = 'shortlisted';

  UPDATE market_research_scores          SET value_numeric = ROUND(value_numeric * 10, 1), value_numeric_office = ROUND(value_numeric_office * 10, 1);
  UPDATE market_research_scores_may2026  SET value_numeric = ROUND(value_numeric * 10, 1), value_numeric_office = ROUND(value_numeric_office * 10, 1);
  UPDATE market_research_scores_sep1_2026 SET value_numeric = ROUND(value_numeric * 10, 1), value_numeric_office = ROUND(value_numeric_office * 10, 1);
  UPDATE market_research_markets SET score = ROUND(score * 10, 1), office_score = ROUND(office_score * 10, 1)
    WHERE score IS NOT NULL OR office_score IS NOT NULL;
  -- earlier snapshots were taken on 0-10; rescale so before/after diffs stay comparable
  UPDATE market_research_rank_snapshots SET score = ROUND(score * 10, 1), office_score = ROUND(office_score * 10, 1);
  UPDATE deal_tracking SET opportunity_score = ROUND(opportunity_score * 10, 1), market_score_res = ROUND(market_score_res * 10, 1), market_score_office = ROUND(market_score_office * 10, 1);
END $$;
