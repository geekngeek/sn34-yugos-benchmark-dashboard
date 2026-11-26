// Server-side only: called from server components, never shipped to the browser.
import type { FilterOptions, Page, Result } from "./types";

const API_URL = (process.env.API_URL ?? "http://localhost:8010").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Params = Record<string, string | string[] | number | boolean | undefined | null>;

async function get<T>(path: string, params: Params = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));   // repeated parameter = several values
    else if (v !== undefined && v !== null && v !== "" && v !== false) qs.set(k, String(v));
  }
  const url = `${API_URL}${path}${qs.size ? `?${qs}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    throw new ApiError(503, `API unreachable at ${API_URL}`);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {}
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export interface ResultQuery {
  q?: string;
  source_id?: string[];
  benchmark_id?: string[];
  area?: string[];
  provider?: string[];
  model_id?: string[];
  reasoning_effort?: string[];
  configs?: string;          // comma-separated model configurations ("<model ID>~<effort>~<mode>"); "none" = nothing
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

/** one model with how much benchmark data it has (GET /api/v1/models) */
export interface ModelCoverage {
  id: string;
  canonical_key: string;     // the project model ID, "vendor/name"
  model_name: string;
  result_count: number;
  benchmark_count: number;
}

/** one benchmark in the database (GET /api/v1/benchmarks) */
export interface BenchmarkInfo {
  id: string;
  benchmark_name: string;
  benchmark_version: string | null;
  area: string | null;
  sub_area: string | null;
  default_score_unit: string | null;
  homepage_url: string | null;
  description: string | null;
  result_count: number;
  model_count: number;
  sources: string[];
}

/** a model as it was run on some benchmarks: model ID + effort + mode (GET /api/v1/configs) */
export interface ModelConfig {
  config: string;
  model_key: string;
  model_name: string;
  provider: string;
  reasoning_effort: string | null;
  mode: string | null;
  results: number;
  best_score: number | null;
  latest: string | null;
  effort_rank: number | null;      // place on the effort ladder within the model (none 0 … max 6)
  yugos_providers: string[];       // world-card providers Yugos can route this configuration to
}

export const api = {
  configs: (benchmarkIds: string[]) => get<ModelConfig[]>("/api/v1/configs", { benchmark_id: benchmarkIds }),
  chartPoints: (benchmarkIds: string[], configs?: string) =>
    get<import("./chartMetrics").ChartPoint[]>("/api/v1/chart-points", { benchmark_id: benchmarkIds, configs }),
  filters: () => get<FilterOptions>("/api/v1/filters"),
  benchmarks: () => get<BenchmarkInfo[]>("/api/v1/benchmarks"),
  models: () => get<ModelCoverage[]>("/api/v1/models"),
  results: (q: ResultQuery) => get<Page<Result>>("/api/v1/results", { ...q }),
};
