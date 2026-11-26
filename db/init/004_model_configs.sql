-- =====================================================================
-- Model configurations: a model as it is run, = model + effort + mode.
--
--   models (anthropic/claude-opus-4.5)
--     └─ model_configs (… @high, … @high +thinking, … default)   <- benchmark_results.config_id
--          └─ yugos_offers (openrouter: anthropic/claude-opus-4.5 @high)
--
-- effort_levels orders efforts WITHIN one model (none < minimal < … < max). The ranks are not
-- comparable across vendors ("max" means different things). NULL effort = "Default": the source did not
-- state one (whatever the provider's default was). "enabled" = reasoning on, level not stated: no rank.
-- Safe to run again (IF NOT EXISTS / ON CONFLICT).
-- =====================================================================

CREATE TABLE IF NOT EXISTS effort_levels (
    effort TEXT PRIMARY KEY,
    rank   INTEGER,                  -- order within a model; NULL = not on the ladder ("enabled")
    label  TEXT NOT NULL
);
INSERT INTO effort_levels (effort, rank, label) VALUES
    ('none', 0, 'Non-reasoning'), ('minimal', 1, 'Minimal'), ('low', 2, 'Low'), ('medium', 3, 'Medium'),
    ('high', 4, 'High'), ('xhigh', 5, 'Xhigh'), ('max', 6, 'Max'), ('enabled', NULL, 'Reasoning (level not stated)')
ON CONFLICT (effort) DO UPDATE SET rank = EXCLUDED.rank, label = EXCLUDED.label;

CREATE TABLE IF NOT EXISTS model_configs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id   UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    effort     TEXT REFERENCES effort_levels(effort),   -- NULL = Default (not stated)
    mode       TEXT,                                    -- search | thinking | fp8 | … ("+"-joined); NULL = plain
    config_key TEXT NOT NULL UNIQUE,                    -- "<model ID>~<effort>~<mode>", empty trailing parts dropped
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT model_configs_uniq UNIQUE NULLS NOT DISTINCT (model_id, effort, mode)
);
CREATE INDEX IF NOT EXISTS model_configs_model_idx ON model_configs (model_id);

ALTER TABLE benchmark_results ADD COLUMN IF NOT EXISTS config_id UUID REFERENCES model_configs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS benchmark_results_config_idx ON benchmark_results (config_id);

-- where Yugos can buy a configuration: one row per world-card listing and effort it accepts
CREATE TABLE IF NOT EXISTS yugos_offers (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id      UUID NOT NULL REFERENCES model_configs(id) ON DELETE CASCADE,
    provider       TEXT NOT NULL,              -- world-card provider (openai, openrouter, venice, …)
    card_model_id  TEXT NOT NULL,              -- that provider's id for the model
    yugos_model    TEXT NOT NULL,              -- the Yugos lineage name (data/yugos/models.json)
    input_usd_m    NUMERIC(12,6),
    output_usd_m   NUMERIC(12,6),
    cached_usd_m   NUMERIC(12,6),
    valid_until    DATE,
    card_synced_at TIMESTAMPTZ,
    CONSTRAINT yugos_offers_uniq UNIQUE (config_id, provider, card_model_id)
);
CREATE INDEX IF NOT EXISTS yugos_offers_config_idx ON yugos_offers (config_id);

-- backfill: one configuration per (model, effort, mode) already in the results
INSERT INTO model_configs (model_id, effort, mode, config_key)
SELECT DISTINCT r.model_id, r.reasoning_effort, r.mode,
       rtrim(m.canonical_key || '~' || COALESCE(r.reasoning_effort, '') || '~' || COALESCE(r.mode, ''), '~')
  FROM benchmark_results r JOIN models m ON m.id = r.model_id
ON CONFLICT DO NOTHING;
UPDATE benchmark_results r SET config_id = c.id
  FROM model_configs c
 WHERE c.model_id = r.model_id AND c.effort IS NOT DISTINCT FROM r.reasoning_effort
   AND c.mode IS NOT DISTINCT FROM r.mode AND r.config_id IS DISTINCT FROM c.id;

-- the result view gains the configuration and the effort's place on the ladder (columns at the end)
CREATE OR REPLACE VIEW v_benchmark_records AS
SELECT
    r.id, b.benchmark_name, b.benchmark_version, b.area, b.sub_area, m.provider, m.model_name, m.model_version,
    r.reasoning_effort, r.benchmark_score, COALESCE(r.score_unit, b.default_score_unit) AS score_unit,
    r.accuracy, COALESCE(r.total_tasks, b.total_tasks) AS total_tasks, r.time_per_task_sec, r.ttft_sec,
    r.tokens_per_sec, r.input_tokens_per_task, r.output_tokens_per_task, r.reasoning_tokens_per_task,
    r.cost_per_task_usd, p.input_token_price, p.output_token_price, p.cache_read_price, p.cache_write_price,
    COALESCE(r.api_provider, p.api_provider) AS api_provider, r.evaluation_method, r.evaluation_date,
    s.source_name, r.source_url, r.published_at, r.collected_at, r.updated_at, r.additional_metrics,
    r.benchmark_id, r.model_id, r.source_id,
    m.canonical_key AS model_key, r.mode, r.model_snapshot, r.raw_model_name, r.model_match,
    -- configuration (004)
    r.config_id, c.config_key, e.rank AS effort_rank
FROM benchmark_results r
JOIN benchmarks b ON b.id = r.benchmark_id
JOIN models     m ON m.id = r.model_id
JOIN sources    s ON s.id = r.source_id
LEFT JOIN model_configs c ON c.id = r.config_id
LEFT JOIN effort_levels e ON e.effort = r.reasoning_effort
LEFT JOIN LATERAL (
    SELECT mp.*
    FROM model_pricing mp
    WHERE mp.model_id = r.model_id
      AND (r.api_provider IS NULL OR mp.api_provider = r.api_provider)
      AND mp.effective_from <= COALESCE(r.evaluation_date, r.collected_at::date)
      AND (mp.effective_to IS NULL
           OR mp.effective_to >= COALESCE(r.evaluation_date, r.collected_at::date))
    ORDER BY (mp.model_snapshot IS NOT DISTINCT FROM r.model_snapshot) DESC,
             (mp.mode IS NOT DISTINCT FROM r.mode) DESC,
             mp.effective_from DESC
    LIMIT 1
) p ON true;

-- one row per configuration: its model, place on the ladder, how many results, and Yugos offers
CREATE OR REPLACE VIEW v_model_configs AS
SELECT c.id, c.config_key, c.model_id, m.canonical_key AS model_key, m.model_name, m.provider,
       c.effort, e.rank AS effort_rank, COALESCE(e.label, 'Default') AS effort_label, c.mode,
       (SELECT count(*) FROM benchmark_results r WHERE r.config_id = c.id)::int AS results,
       (SELECT count(*) FROM yugos_offers o WHERE o.config_id = c.id)::int AS yugos_offers,
       (SELECT array_agg(DISTINCT o.provider ORDER BY o.provider) FROM yugos_offers o WHERE o.config_id = c.id) AS yugos_providers
  FROM model_configs c
  JOIN models m ON m.id = c.model_id
  LEFT JOIN effort_levels e ON e.effort = c.effort;
