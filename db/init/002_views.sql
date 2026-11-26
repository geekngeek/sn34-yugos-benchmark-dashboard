-- =====================================================================
-- v_benchmark_records: flat, one-row-per-result view with exactly the
-- fields of the original record spec. The API layer reads from this.
--
-- Pricing is taken from model_pricing as of the evaluation date
-- (falls back to collection date), matching the result's api_provider
-- when one is given.
-- =====================================================================

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
    -- ids for joins / links from the API
    r.benchmark_id,
    r.model_id,
    r.source_id
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
    ORDER BY mp.effective_from DESC
    LIMIT 1
) p ON true;

-- Latest result per (benchmark, model, reasoning_effort) across sources —
-- handy for leaderboard pages.
CREATE OR REPLACE VIEW v_latest_results AS
SELECT DISTINCT ON (benchmark_id, model_id, reasoning_effort) *
FROM v_benchmark_records
ORDER BY benchmark_id, model_id, reasoning_effort,
         evaluation_date DESC NULLS LAST, collected_at DESC;
