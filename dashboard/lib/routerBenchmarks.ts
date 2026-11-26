// Server-side only: the router-benchmark research catalog.
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const FILE = path.join(process.cwd(), "..", "data", "router-benchmarks", "benchmarks.json");   // built by scripts/build_router_benchmarks.py
const STATE = path.join(path.dirname(FILE), "user-state.json");   // written by this app: feedback notes + archived benchmarks

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
  pool?: {
    models: string[]; total: number | null; approx: boolean; note: string;
    /** pool name -> Yugos model id, for the names the Yugos router can pick (data/yugos/models.json) */
    yugos?: Record<string, string>;
  } | null;
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

/** the user's own feedback per benchmark, keyed by benchmark name (survives rebuilds that renumber rows) */
export interface RouterUserState {
  notes: Record<string, string>;
  archived: string[];
  updated: string | null;
}

export async function readRouterState(): Promise<RouterUserState> {
  try {
    const s = JSON.parse(await readFile(STATE, "utf8"));
    return { notes: s.notes ?? {}, archived: s.archived ?? [], updated: s.updated ?? null };
  } catch {
    return { notes: {}, archived: [], updated: null };
  }
}

// one write at a time, so two quick saves can't overwrite each other
let queue: Promise<unknown> = Promise.resolve();

export function updateRouterState(change: (s: RouterUserState) => void): Promise<RouterUserState> {
  const job = queue.then(async () => {
    const s = await readRouterState();
    change(s);
    s.updated = new Date().toISOString();
    const tmp = `${STATE}.tmp`;
    await writeFile(tmp, JSON.stringify(s, null, 1), "utf8");
    await rename(tmp, STATE);   // readers never see a half-written file
    return s;
  });
  queue = job.catch(() => undefined);
  return job;
}
