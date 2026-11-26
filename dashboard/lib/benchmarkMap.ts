// Server-side only: one Benchmark list row with its sub-benchmarks, and the database benchmarks it links to
// (data/benchmark-map.json, built by scripts/build_benchmark_map.py).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { MY_NOTES, readList } from "@/lib/benchmarkList";
import { parseMetrics, type Metrics } from "@/lib/metrics";

export interface MapRef { source: string; name: string; version: string | null; results: number; method: string }
export interface MapRow { no: string; kind: "parent" | "sub"; name: string; parent?: string; overall?: MapRef | null; benchmarks: MapRef[] }

export async function readBenchmarkMap(): Promise<Record<string, MapRow>> {
  try {
    const doc = JSON.parse(await readFile(path.join(process.cwd(), "..", "data", "benchmark-map.json"), "utf8"));
    return doc.rows ?? {};
  } catch {
    return {};   // not built yet: pages still show the list's own details
  }
}

export interface ListRow {
  no: string;
  name: string;
  yugos: string;
  category: string;
  url: string;
  focus: string;
  top: string;
  yugosUse: string;
  notes: string;
  myNotes: string;
  metrics: Metrics;
  extra: [string, string][];
}

const KNOWN = ["No", "Yugos", "Name", "Category", "URL", "Focus", "Top Ranked Models", "Yugos use?", "Notes", MY_NOTES, "Metrics", "Metrics detail"];

/** every row of dashboard/public/benchmark-list.csv, in file order */
export async function readListRows(): Promise<ListRow[]> {
  const { header, rows } = await readList();
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const get = (r: string[], name: string) => { const i = col(name); return i < 0 ? "" : (r[i] ?? "").trim(); };
  const extras = header.filter((h) => !KNOWN.some((k) => k.toLowerCase() === h.toLowerCase()));
  return rows.filter((r) => (r[0] ?? "").trim()).map((r) => ({
    no: (r[0] ?? "").trim(), name: get(r, "Name"), yugos: get(r, "Yugos"), category: get(r, "Category"),
    url: get(r, "URL"), focus: get(r, "Focus"), top: get(r, "Top Ranked Models"), yugosUse: get(r, "Yugos use?"),
    notes: get(r, "Notes"), myNotes: get(r, MY_NOTES), metrics: parseMetrics(get(r, "Metrics detail")),
    extra: extras.map((h) => [h, get(r, h)] as [string, string]).filter(([, v]) => v),
  }));
}

export const parentOf = (no: string) => (no.match(/^(\d+)\.\d+$/)?.[1] ?? null);
