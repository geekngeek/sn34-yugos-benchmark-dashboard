-- =====================================================================
-- Model IDs (importer/model_ids.py, data/models/):
--   models.canonical_key  holds the project model ID, "vendor/name" (e.g. anthropic/claude-opus-4.5)
--   each result keeps how the model was run (effort, mode), which dated snapshot it was,
--   the source's own name for the model, and how that name was matched.
-- Safe to run on an existing database (everything is IF NOT EXISTS / OR REPLACE).
-- =====================================================================

COMMENT ON COLUMN models.canonical_key IS
    'Project model ID "vendor/name" from data/models/registry.csv (importer/model_ids.py)';

ALTER TABLE benchmark_results
    ADD COLUMN IF NOT EXISTS mode           TEXT,   -- search | codex-harness | fp8 | … ("+"-joined); NULL = plain
    ADD COLUMN IF NOT EXISTS model_snapshot TEXT,   -- dated snapshot as the source wrote it ("2024-10-22", "Nov 2024")
    ADD COLUMN IF NOT EXISTS raw_model_name TEXT,   -- the source's own name for the model
    ADD COLUMN IF NOT EXISTS model_match    TEXT;   -- rule | yugos-exact | yugos-loose | override | unlisted

CREATE INDEX IF NOT EXISTS benchmark_results_raw_name_idx ON benchmark_results (source_id, raw_model_name);

-- a price belongs to the offer: the same model can cost differently per dated snapshot
-- (GPT-4o May '24 $5/$15 vs Aug '24 $2.50/$10) or per precision (self-hosted FP8 vs the API)
ALTER TABLE model_pricing
    ADD COLUMN IF NOT EXISTS model_snapshot TEXT,
    ADD COLUMN IF NOT EXISTS mode           TEXT,
    ADD COLUMN IF NOT EXISTS raw_model_name TEXT;
ALTER TABLE model_pricing DROP CONSTRAINT IF EXISTS model_pricing_uniq;
ALTER TABLE model_pricing ADD CONSTRAINT model_pricing_uniq
    UNIQUE NULLS NOT DISTINCT (model_id, api_provider, effective_from, model_snapshot, mode);

CREATE OR REPLACE VIEW v_benchmark_records AS
SELECT
    r.id,
    b.benchmark_name,
    b.benchmark_version,
    b.area,
    b.sub_area,
    m.provider,
    m.model_name,
    m.model_version,
    r.reasoning_effort,
    r.benchmark_score,
    COALESCE(r.score_unit, b.default_score_unit)  AS score_unit,
    r.accuracy,
    COALESCE(r.total_tasks, b.total_tasks)        AS total_tasks,
    r.time_per_task_sec,
    r.ttft_sec,
    r.tokens_per_sec,
    r.input_tokens_per_task,
    r.output_tokens_per_task,
    r.reasoning_tokens_per_task,
    r.cost_per_task_usd,
    p.input_token_price,
    p.output_token_price,
    p.cache_read_price,
    p.cache_write_price,
    COALESCE(r.api_provider, p.api_provider)      AS api_provider,
    r.evaluation_method,
    r.evaluation_date,
    s.source_name,
    r.source_url,
    r.published_at,
    r.collected_at,
    r.updated_at,
    r.additional_metrics,
    r.benchmark_id,
    r.model_id,
    r.source_id,
    -- model ID and run configuration (003)
    m.canonical_key                               AS model_key,
    r.mode,
    r.model_snapshot,
    r.raw_model_name,
    r.model_match
FROM benchmark_results r
JOIN benchmarks b ON b.id = r.benchmark_id
JOIN models     m ON m.id = r.model_id
JOIN sources    s ON s.id = r.source_id
LEFT JOIN LATERAL (
    SELECT mp.*
    FROM model_pricing mp
    WHERE mp.model_id = r.model_id
      AND (r.api_provider IS NULL OR mp.api_provider = r.api_provider)
      AND mp.effective_from <= COALESCE(r.evaluation_date, r.collected_at::date)
      AND (mp.effective_to IS NULL
           OR mp.effective_to >= COALESCE(r.evaluation_date, r.collected_at::date))
    -- prefer the price of the same snapshot and mode as the result
    ORDER BY (mp.model_snapshot IS NOT DISTINCT FROM r.model_snapshot) DESC,
             (mp.mode IS NOT DISTINCT FROM r.mode) DESC,
             mp.effective_from DESC
    LIMIT 1
) p ON true;

-- Latest result per configuration: (benchmark, model, effort, mode).
CREATE OR REPLACE VIEW v_latest_results AS
SELECT DISTINCT ON (benchmark_id, model_id, reasoning_effort, mode) *
FROM v_benchmark_records
ORDER BY benchmark_id, model_id, reasoning_effort, mode,
         evaluation_date DESC NULLS LAST, collected_at DESC;
