import type { Metadata } from "next";
import { BenchmarkTree, type TreeItem } from "@/components/BenchmarkTree";
import { readLayout } from "@/lib/uiLayout";
import { LIST_FILE, MY_NOTES, readList } from "@/lib/benchmarkList";
import { parseMetrics } from "@/lib/metrics";
import { parseDifficulty, spanOf } from "@/lib/difficulty";
import { readDatasetMatches, readSubMatches } from "@/lib/yugosMatchData";
import { liveSetsIn, MATCH_CATS, tripleOf } from "@/lib/yugosMatch";

export const metadata: Metadata = { title: "Benchmark list · LLM Benchmark Results" };
export const dynamic = "force-dynamic";   // re-read the file on every visit, so edits show up at once

// CSV columns the tree shows in fixed places; any other column appears in the details panel
const KNOWN = ["No", "Yugos", "Name", "Category", "URL", "Focus", "Top Ranked Models", "Yugos use?", "Notes", MY_NOTES, "Metrics", "Metrics detail", "Difficulty", "Difficulty detail"];

/**
 * The team's benchmark list, read from dashboard/public/benchmark-list.csv (also the download).
 * Rows numbered "<parent No>.<n>" (2.1, 2.2, …) are sub-benchmarks of row <parent No>.
 */
export default async function BenchmarkListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const expandAll = sp.expand === "all";              // /benchmarks?expand=all opens every group
  const initialView = sp.view === "params" ? "params" : "tree";   // /benchmarks?view=params opens the parameters grid
  const [{ header, rows }, layout, matches, datasets] = await Promise.all([readList(), readLayout("benchmark-list"), readSubMatches(), readDatasetMatches()]);
  // live Yugos sets (data/yugos-match/datasets.json): id -> name, for the Live overlap column
  const liveSets = Object.fromEntries((datasets?.datasets ?? []).filter((d) => d.yugos === "live").map((d) => [d.id, d.name]));
  const liveIds = Object.keys(liveSets);
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const get = (r: string[], name: string) => { const i = col(name); return i < 0 ? "" : (r[i] ?? "").trim(); };
  const extras = header.filter((h) => !KNOWN.some((k) => k.toLowerCase() === h.toLowerCase()));

  const toItem = (r: string[]): TreeItem => ({
    no: (r[0] ?? "").trim(), name: get(r, "Name"), yugos: get(r, "Yugos"), category: get(r, "Category"),
    url: get(r, "URL"), focus: get(r, "Focus"), top: get(r, "Top Ranked Models"), yugosUse: get(r, "Yugos use?"),
    notes: get(r, "Notes"), myNotes: get(r, MY_NOTES), metrics: parseMetrics(get(r, "Metrics detail")), difficulty: parseDifficulty(get(r, "Difficulty"), get(r, "Difficulty detail")), extra: extras.map((h) => [h, get(r, h)]), children: [],
  });
  const items: TreeItem[] = [];
  const byNo = new Map<string, TreeItem>();
  for (const r of rows) {
    const item = toItem(r);
    const parent = byNo.get(item.no.match(/^(\d+)\.\d+$/)?.[1] ?? "");
    if (parent) parent.children.push(item);
    else { items.push(item); byNo.set(item.no, item); }
  }
  // a parent shows the span of levels its sub-benchmarks cover (its own level if it has no levelled subs)
  for (const p of items) p.difficulty = spanOf(p.children.map((c) => c.difficulty), p.difficulty);
  // Yugos match (data/yugos-match/subbenchmarks.json): each sub-benchmark's scores; a parent shows its best sub-benchmark per category
  for (const p of items) {
    for (const c of p.children) {
      const m = matches?.rows[c.no];
      if (m) { c.match = m; c.fit = tripleOf(m); c.live = m.live_overlap ? liveSetsIn(m.overlap, liveIds) : []; }
    }
    p.live = liveIds.filter((id) => p.children.some((c) => c.live?.includes(id)));
    const scored = p.children.filter((c) => c.fit);
    if (scored.length) p.fit = Object.fromEntries(MATCH_CATS.map((k) => [k, Math.max(...scored.map((c) => c.fit![k]))])) as typeof p.fit;
  }

  return (
    <main className="page wide">
      <header className="page-head row spread">
        <div>
          <h1>Benchmark list</h1>
          <p className="muted small">{items.length} benchmarks · click a row for details and notes</p>
        </div>
        <a className="button" href={`/${LIST_FILE}`} download="LLM_Benchmarks.csv">
          <span aria-hidden="true">⬇</span> Download CSV
        </a>
      </header>
      <BenchmarkTree items={items} expandAll={expandAll} initialView={initialView} layout={layout} query={sp} matchTargets={matches?.targets ?? null} liveSets={liveSets} />
    </main>
  );
}
