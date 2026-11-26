// Server-side only: the router-benchmark research catalog.
import { readFile } from "node:fs/promises";
import path from "node:path";

const FILE = path.join(process.cwd(), "..", "data", "router-benchmarks", "benchmarks.json");   // built by scripts/build_router_benchmarks.py

export type Usefulness = "High" | "Medium" | "Low–Medium" | "Low" | "No" | "?";
export type Freshness = "Yes" | "Partly" | "No" | "Unknown";

import type { PublicField, PublicStatus } from "./routerPublicFields";

export interface RouterBenchmark {
  num: number;
  group: "A" | "B" | "C" | "D";
  group_label: string;
  name: string;
  creators: string;
  scale: string;
  models: string;
  /** exact model names (newest / most notable first) and pool size, from data/router-benchmarks/model_pools.json */
  pool?: { models: string[]; total: number | null; approx: boolean; note: string } | null;
  focus: string;
  newest: Freshness;
  newest_raw: string;
  yugos: Usefulness;
  yugos_raw: string;
  links: { label: string; url: string }[];
  link_text: string;
  finding: string;
  file: string | null;
  detail_md: string;
  /** which fields can be downloaded per question (null: not in the public-fields research) */
  public: Record<PublicField, { status: PublicStatus; note: string }> | null;
  licence: string | null;
}

export interface RouterBenchmarkCatalog {
  built_at: string;
  research_date: string;
  source_dir: string;
  groups: Record<string, string>;
  benchmarks: RouterBenchmark[];
}

export async function readRouterBenchmarks(): Promise<RouterBenchmarkCatalog> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as RouterBenchmarkCatalog;
  } catch {
    return { built_at: "", research_date: "", source_dir: "", groups: {}, benchmarks: [] };
  }
}
