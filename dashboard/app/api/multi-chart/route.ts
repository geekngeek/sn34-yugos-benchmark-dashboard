import { api, type BenchmarkInfo, type ModelConfig } from "@/lib/api";
import { parentOf, readBenchmarkMap, readListRows, type MapRef } from "@/lib/benchmarkMap";
import { readList } from "@/lib/benchmarkList";
import { readChartColors } from "@/lib/chartColors";
import { parseDifficulty, spanOf, type Difficulty } from "@/lib/difficulty";
import type { ChartPoint } from "@/lib/chartMetrics";
import type { MultiChartData, Series } from "@/lib/multiChart";
import { readModelLinks, readState } from "@/lib/yugosModels";
import { readArchive } from "@/lib/archive";
import { readSubMatches } from "@/lib/yugosMatchData";
import { MATCH_CATS, tripleOf, type MatchTriple } from "@/lib/yugosMatch";

/**
 * POST {nos: ["5", "12.3", …], models: null | ["<config>", …]} -> what the combined chart of the Benchmark list
 * draws. A sub-benchmark (12.3) brings the database benchmarks it is linked to; a benchmark (5) brings its overall
 * one (else its biggest), as on its details page. models null = the default selection: the models selected on the
 * Yugos models page that have results here, else the 30 best.
 */
export async function POST(req: Request) {
  let body: { nos?: unknown; models?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  const nos = Array.isArray(body.nos) ? body.nos.filter((n): n is string => typeof n === "string").slice(0, 400) : [];
  const models = Array.isArray(body.models) ? body.models.filter((c): c is string => typeof c === "string") : null;

  const [rows, map, dbList, csv, matches] = await Promise.all([
    readListRows(), readBenchmarkMap(), api.benchmarks().catch((): BenchmarkInfo[] => []), readList(), readSubMatches(),
  ]);
  // Yugos fit per row, as the Benchmark list shows it: a sub-benchmark's own, a benchmark's best sub-benchmark per category
  const fitOf = (no: string): MatchTriple | null => {
    const own = matches?.rows[no];
    if (parentOf(no)) return own ? tripleOf(own) : null;
    const kids = Object.keys(matches?.rows ?? {}).filter((k) => parentOf(k) === no).map((k) => tripleOf(matches!.rows[k]));
    return kids.length ? Object.fromEntries(MATCH_CATS.map((c) => [c, Math.max(...kids.map((t) => t[c]))])) as MatchTriple : null;
  };
  // difficulty per row, as the Benchmark list shows it (a benchmark: the span of its sub-benchmarks' levels)
  const col = (n: string) => csv.header.findIndex((h) => h.trim().toLowerCase() === n.toLowerCase());
  const dCol = col("Difficulty"), ddCol = col("Difficulty detail");
  const own = new Map<string, Difficulty>(csv.rows.filter((r) => (r[0] ?? "").trim()).map((r) => [r[0].trim(),
    parseDifficulty(dCol < 0 ? "" : r[dCol] ?? "", ddCol < 0 ? "" : r[ddCol] ?? "")]));
  const levelOf = (no: string): { difficulty: Difficulty; span: boolean } => {
    const d = own.get(no) ?? parseDifficulty("", "");
    if (parentOf(no)) return { difficulty: d, span: false };
    const kids = [...own.entries()].filter(([k]) => parentOf(k) === no).map(([, v]) => v);
    return { difficulty: spanOf(kids, d), span: kids.length > 0 };
  };
  const byKey = new Map(dbList.map((b) => [`${b.benchmark_name}|${b.benchmark_version ?? ""}`, b]));
  const info = (r: MapRef) => byKey.get(`${r.name}|${r.version ?? ""}`);
  const nameOf = new Map(rows.map((r) => [r.no, r.name]));

  const series = new Map<string, Series>();
  const unlinked: { no: string; name: string }[] = [];
  for (const no of nos) {
    const m = map[no];
    let refs = (m?.benchmarks ?? []).filter((r) => info(r));
    if (m?.kind === "parent") {
      const overall = m.overall && info(m.overall) ? m.overall : [...refs].sort((a, z) => (info(z)?.result_count ?? 0) - (info(a)?.result_count ?? 0))[0];
      refs = overall ? [overall] : [];
    }
    if (!refs.length) { unlinked.push({ no, name: nameOf.get(no) ?? no }); continue; }
    for (const r of refs) {
      const b = info(r)!;
      const s = series.get(b.id);
      if (s) { if (!s.nos.includes(no)) s.nos.push(no); continue; }
      series.set(b.id, { id: b.id, label: nameOf.get(no) ?? b.benchmark_name, root: parentOf(no) ? nameOf.get(parentOf(no)!) ?? null : null, ...levelOf(no), fit: fitOf(no), db: [b.benchmark_name, b.benchmark_version].filter(Boolean).join(" · "),
                         nos: [no], results: b.result_count, sources: b.sources });
    }
  }
  // one list name for several database benchmarks (AIME 2025 from three sources): add the source, then the database name
  const list = [...series.values()];
  for (const pass of [(x: Series) => x.sources.join(", "), (x: Series) => x.db]) {
    const seen = new Map<string, number>();
    const id = (x: Series) => `${x.root ?? ""}|${x.label}`;      // the root name is shown too, so only clashes under one root count
    list.forEach((x) => seen.set(id(x), (seen.get(id(x)) ?? 0) + 1));
    list.forEach((x) => { if (seen.get(id(x))! > 1) x.label = `${x.label} · ${pass(x)}`; });
  }
  const ids = [...series.keys()];

  const [configs, yugosState, yugosLinks, customColors, archivedModels] = await Promise.all([
    configsFor(ids),
    readState(), readModelLinks(), readChartColors(), readArchive("yugos-models"),
  ]);
  const out = new Set([...yugosState.excluded, ...Object.keys(archivedModels)]);   // archived models are never selected
  const yugos = [...new Set(Object.entries(yugosLinks).filter(([m]) => !out.has(m)).map(([, l]) => l.modelId).filter(Boolean))];
  const ySet = new Set(yugos);
  const fromYugos = configs.filter((c) => ySet.has(c.model_key)).map((c) => c.config);
  const defaults = fromYugos.length ? fromYugos : configs.slice(0, 30).map((c) => c.config);
  const defaultNote = fromYugos.length
    ? `Default: the models selected on the Yugos models page (${new Set(configs.filter((c) => ySet.has(c.model_key)).map((c) => c.model_key)).size} have results on these benchmarks).`
    : "Default: the 30 best-scoring models (none of the models selected on the Yugos models page has results here).";
  const known = new Set(configs.map((c) => c.config));
  const selected = models ? models.filter((c) => known.has(c)) : defaults;
  const everything = selected.length === configs.length;
  // a long selection would not fit in the API's query string: fetch every configuration and keep the chosen ones
  const wide = everything || selected.length > 80;
  const want = new Set(selected);
  const points = ids.length && selected.length
    ? (await Promise.all(chunks(ids).map((part) => api.chartPoints(part, wide ? undefined : selected.join(",")).catch((): ChartPoint[] => []))))
        .flat().filter((p) => everything || want.has(p.config)) : [];

  const data: MultiChartData = { series: [...series.values()], unlinked, configs, selected, defaults, defaultNote, yugos, points, customColors };
  return Response.json(data);
}

/** many benchmark ids would overflow the API's query string: ask in parts */
const chunks = (ids: string[], n = 60) => Array.from({ length: Math.ceil(ids.length / n) }, (_, i) => ids.slice(i * n, i * n + n));

/** the configurations with results on any of the benchmarks (parts merged: results added, best score kept) */
async function configsFor(ids: string[]): Promise<ModelConfig[]> {
  const parts = await Promise.all(chunks(ids).map((part) => api.configs(part).catch((): ModelConfig[] => [])));
  const m = new Map<string, ModelConfig>();
  for (const c of parts.flat()) {
    const had = m.get(c.config);
    if (!had) { m.set(c.config, { ...c }); continue; }
    had.results += c.results;
    if (c.best_score !== null && (had.best_score === null || c.best_score > had.best_score)) had.best_score = c.best_score;
    if (c.latest && (!had.latest || c.latest > had.latest)) had.latest = c.latest;
  }
  return [...m.values()].sort((a, b) => (b.best_score ?? -1) - (a.best_score ?? -1) || a.model_name.localeCompare(b.model_name));
}
