-- Placeholder data for local development only. Names and numbers are
-- made up — NOT real benchmark results. Load manually:
--   docker compose exec -T db psql -U bench -d llm_bench < db/samples/sample_data.sql

BEGIN;

INSERT INTO sources (source_name, homepage_url) VALUES
    ('Example Source', 'https://example.com/leaderboard');

INSERT INTO models (canonical_key, provider, model_name, model_version, aliases) VALUES
    ('example-model', 'ExampleAI', 'Example Model', 'example-model-2026-01-01', ARRAY['example-model']);

INSERT INTO benchmarks (benchmark_name, benchmark_version, area, sub_area, default_score_unit, total_tasks) VALUES
    ('Example-Bench', 'v1', 'coding', 'bug fixing', 'percentage', 500);

INSERT INTO raw_data (source_id, source_url, fetch_method, payload, content_hash)
SELECT s.id, 'https://example.com/leaderboard.json', 'api',
       '{"model": "example-model", "score": 61.2, "effort": "high"}'::jsonb,
       encode(digest('{"model": "example-model", "score": 61.2, "effort": "high"}', 'sha256'), 'hex')
FROM sources s WHERE s.source_name = 'Example Source';

INSERT INTO model_pricing (model_id, api_provider, input_token_price, output_token_price,
                           cache_read_price, cache_write_price, effective_from, source_id)
SELECT m.id, 'ExampleAI', 1.25, 10.00, 0.125, 1.5625, DATE '2026-01-01', s.id
FROM models m, sources s
WHERE m.model_name = 'Example Model' AND s.source_name = 'Example Source';

INSERT INTO benchmark_results (
    benchmark_id, model_id, source_id, raw_data_id, external_id,
    reasoning_effort, api_provider, evaluation_method, evaluation_date,
    benchmark_score, score_unit, accuracy, total_tasks,
    time_per_task_sec, ttft_sec, tokens_per_sec,
    input_tokens_per_task, output_tokens_per_task, reasoning_tokens_per_task,
    cost_per_task_usd, source_url, published_at, additional_metrics)
SELECT b.id, m.id, s.id, rd.id, 'example-run-1',
       'high', 'ExampleAI', 'pass@1, default scaffold', DATE '2026-02-01',
       61.2, 'percentage', 61.2, 500,
       142.5, 0.85, 95.3,
       24000, 3100, 8200,
       0.142, 'https://example.com/leaderboard', TIMESTAMPTZ '2026-02-03 00:00+00',
       '{"resolved": 306, "pass_at_5": 72.4}'::jsonb
FROM benchmarks b, models m, sources s, raw_data rd
WHERE b.benchmark_name = 'Example-Bench'
  AND m.model_name = 'Example Model'
  AND s.source_name = 'Example Source'
  AND rd.source_id = s.id;

UPDATE raw_data SET parsed_at = now();

COMMIT;
