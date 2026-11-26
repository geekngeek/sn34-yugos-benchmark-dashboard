// What the trade-off chart can put on an axis (fields of GET /api/v1/chart-points).

export type MetricKey = "quality" | "accuracy" | "cost_per_task" | "time_per_task" | "ttft" | "output_tokens"
  | "output_price" | "input_price" | "tokens_per_sec" | "date";

export interface ChartPoint {
  config: string;
  model_key: string;
  model_name: string;
  provider: string;
  reasoning_effort: string | null;
  mode: string | null;
  effort_rank: number | null;
  benchmark_name: string;
  benchmark_version: string | null;
  source_name: string;
  quality: number | null;
  sort_score: number | null;
  accuracy: number | null;
  cost_per_task: number | null;
  time_per_task: number | null;
  ttft: number | null;
  tokens_per_sec: number | null;
  output_tokens: number | null;
  output_price: number | null;
  input_price: number | null;
  date: string | null;
  yugos_providers: string[];
}

export interface Metric {
  key: MetricKey;
  label: string;          // axis title
  short: string;          // option text
  log: boolean;           // log scale by default (values spanning orders of magnitude)
  format: (v: number) => string;
}

const usd = (v: number) => (v === 0 ? "$0" : v < 0.01 ? `$${v.toPrecision(2)}` : v < 10 ? `$${v.toFixed(2)}` : `$${v.toFixed(0)}`);
const secs = (v: number) => (v < 10 ? `${v.toFixed(1)}s` : `${v.toFixed(0)}s`);
const big = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k` : v.toFixed(0));

export const METRICS: Record<MetricKey, Metric> = {
  quality: { key: "quality", label: "Quality (score, 0–100)", short: "Quality (score)", log: false, format: (v) => v.toFixed(1) },
  accuracy: { key: "accuracy", label: "Accuracy (%)", short: "Accuracy", log: false, format: (v) => `${v.toFixed(1)}%` },
  cost_per_task: { key: "cost_per_task", label: "Cost per task (USD)", short: "Price / task", log: true, format: usd },
  time_per_task: { key: "time_per_task", label: "Time per task (seconds)", short: "Latency / task", log: true, format: secs },
  ttft: { key: "ttft", label: "Time to first token (seconds)", short: "Time to first token", log: true, format: secs },
  output_tokens: { key: "output_tokens", label: "Output tokens per task", short: "Output tokens / task", log: true, format: big },
  output_price: { key: "output_price", label: "Output price (USD per 1M tokens; current when the result is older)", short: "Output price / 1M", log: true, format: usd },
  input_price: { key: "input_price", label: "Input price (USD per 1M tokens; current when the result is older)", short: "Input price / 1M", log: true, format: usd },
  tokens_per_sec: { key: "tokens_per_sec", label: "Output speed (tokens per second)", short: "Output speed", log: false, format: big },
  date: { key: "date", label: "Date of the result", short: "Date", log: false,
          format: (v) => new Date(v).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) },
};

export const AXIS_ORDER: MetricKey[] = ["quality", "accuracy", "cost_per_task", "time_per_task", "ttft", "output_tokens",
  "output_price", "input_price", "tokens_per_sec", "date"];

/** X falls back in this order when the benchmark has no data for the earlier ones */
export const X_FALLBACK: MetricKey[] = ["cost_per_task", "time_per_task", "ttft", "output_tokens", "output_price",
  "tokens_per_sec", "date"];

export function value(p: ChartPoint, k: MetricKey): number | null {
  if (k === "date") return p.date ? Date.parse(p.date) : null;
  return p[k];
}

/** how many points have a value for each metric */
export function coverage(points: ChartPoint[]): Record<MetricKey, number> {
  const out = {} as Record<MetricKey, number>;
  for (const k of AXIS_ORDER) out[k] = points.filter((p) => value(p, k) !== null).length;
  return out;
}

/** default axes: Y quality; X the first fallback with at least 3 points (both values present) */
export function defaultAxes(points: ChartPoint[]): { x: MetricKey; y: MetricKey } {
  const y: MetricKey = "quality";
  const usable = (k: MetricKey) => points.filter((p) => value(p, k) !== null && value(p, y) !== null).length >= 3;
  return { x: X_FALLBACK.find(usable) ?? "date", y };
}
