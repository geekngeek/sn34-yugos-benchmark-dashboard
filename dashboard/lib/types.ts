// Mirrors api/schemas.py (only what the dashboard uses)

export interface Result {
  id: string;
  benchmark_id: string;
  model_id: string;
  source_id: string;
  benchmark_name: string;
  benchmark_version: string | null;
  area: string | null;
  sub_area: string | null;
  provider: string;
  model_name: string;
  model_version: string | null;
  reasoning_effort: string | null;
  model_key?: string | null;       // project model ID, "vendor/name" (data/models/registry.csv)
  mode?: string | null;            // search | codex-harness | fp8 | … ("+"-joined)
  model_snapshot?: string | null;  // dated snapshot as the source wrote it
  raw_model_name?: string | null;  // the source's own name for the model
  model_match?: string | null;     // rule | yugos-exact | yugos-loose | yugos-same-model | override
  benchmark_score: number | null;
  score_unit: string | null;
  display_score: number | null;  // the score on a 0-100 scale when it was converted (api/scales.py)
  scale_note: string | null;     // what the original number is: "Elo", "task-hours of 690", "lower is better"
  accuracy: number | null;
  total_tasks: number | null;
  time_per_task_sec: number | null;
  ttft_sec: number | null;
  tokens_per_sec: number | null;
  output_tokens_per_task: number | null;
  cost_per_task_usd: number | null;
  input_token_price: number | null;
  output_token_price: number | null;
  api_provider: string | null;
  evaluation_method: string | null;
  evaluation_date: string | null;
  source_name: string;
  source_url: string | null;
  published_at: string | null;
  collected_at: string;
  additional_metrics: Record<string, unknown>;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface FilterOptions {
  sources: { id: string; source_name: string; result_count: number }[];
  benchmarks: {
    id: string;
    benchmark_name: string;
    benchmark_version: string | null;
    area: string | null;
    sources: string[];
    result_count: number;
  }[];
  models: { id: string; model_name: string; provider: string; result_count: number }[];
  areas: string[];
  providers: string[];
  reasoning_efforts: string[];
  sorts: string[];
}
