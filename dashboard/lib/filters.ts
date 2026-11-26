// Filter state shared by the server page and the client filter bar (no "use client" here).

export const LIST_FILTERS = ["source_id", "benchmark_id", "area", "provider", "model_id", "reasoning_effort"] as const;
export type ListKey = (typeof LIST_FILTERS)[number];

export interface FilterValues {
  q: string;
  source_id: string[];
  benchmark_id: string[];
  area: string[];
  provider: string[];
  model_id: string[];
  reasoning_effort: string[];
  sort: string;
  order: string;
  limit: string;
}

export const EMPTY_FILTERS = {
  q: "", source_id: [], benchmark_id: [], area: [], provider: [], model_id: [], reasoning_effort: [],
} satisfies Partial<FilterValues>;

/** URL query; list filters repeat their parameter (?area=coding&area=math). */
export function toQuery(v: FilterValues): string {
  const qs = new URLSearchParams();
  if (v.q.trim()) qs.set("q", v.q.trim());
  for (const k of LIST_FILTERS) v[k].forEach((x) => qs.append(k, x));
  qs.set("sort", v.sort);
  qs.set("order", v.order);
  qs.set("limit", v.limit);
  return qs.toString();
}
