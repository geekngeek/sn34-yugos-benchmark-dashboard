import type { Metadata } from "next";
import { DatasetsTable } from "@/components/DatasetsTable";
import { readDatasetMatches } from "@/lib/yugosMatchData";
import { readLayout } from "@/lib/uiLayout";
import { readArchive } from "@/lib/archive";
import "../router-benchmarks/router-benchmarks.css";
import "./datasets.css";

export const metadata: Metadata = { title: "Datasets · LLM Benchmark Results" };
export const dynamic = "force-dynamic";   // re-read the data on every visit

/** Public datasets scored on how well their questions could stand in for Yugos's chat, math & code and agentic questions. */
export default async function DatasetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const [file, layout, archived] = await Promise.all([readDatasetMatches(), readLayout("datasets"), readArchive("datasets")]);
  const data = file?.datasets ?? [];
  return (
    <main className="page wide">
      <header className="rb-header">
        <h1>Datasets</h1>
        <p className="page-lead">
          Public datasets that could give the Yugos router more training data. Each gets three match scores: how far its questions behave like
          Yugos&apos;s chat, math &amp; code and agentic questions (task, turns, answer and grading, domain, difficulty, freshness, length).
          Method: <code>docs/yugos-match.md</code>{file?.built_at ? ` · built ${file.built_at.slice(0, 10)}` : ""}.
        </p>
      </header>
      {data.length === 0 ? (
        <p className="rb-empty">No data yet. Build it with <code>python3 -I scripts/build_yugos_match.py build</code>.</p>
      ) : (
        <DatasetsTable archived={archived} data={data} targets={file?.targets ?? null} layout={layout} query={sp} />
      )}
    </main>
  );
}
