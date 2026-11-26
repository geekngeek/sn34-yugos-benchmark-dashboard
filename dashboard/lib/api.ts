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
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export const api = {
  filters: () => get<FilterOptions>("/api/v1/filters"),
  results: (q: ResultQuery) => get<Page<Result>>("/api/v1/results", { ...q }),
};
