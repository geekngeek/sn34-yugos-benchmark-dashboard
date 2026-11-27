import type { Metadata } from "next";
import { RouterBenchmarksTable } from "@/components/RouterBenchmarksTable";
import { readRouterBenchmarks, readRouterState } from "@/lib/routerBenchmarks";
import { readLayout } from "@/lib/uiLayout";
import "./router-benchmarks.css";

export const metadata: Metadata = { title: "Router benchmarks · LLM Benchmark Results" };
export const dynamic = "force-dynamic";   // re-read the catalog on every visit

/** Every known LLM-router benchmark and router-relevant data source, from the router-benchmark research. */
export default async function RouterBenchmarksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;   // view state (filters, sort, open row) lives in the URL
  const [catalog, layout, state] = await Promise.all([readRouterBenchmarks(), readLayout("router-benchmarks"), readRouterState()]);
  return (
    <main className="page wide">
      <header className="rb-header">
        <h1>Router benchmarks</h1>
        <p className="page-lead">
          Benchmarks and data sets for testing LLM routers (which model and effort to pick per question), with how useful each one is for the
          Yugos router. Research of {catalog.research_date || "—"}; click a row for the full write-up.
        </p>
      </header>
      {catalog.benchmarks.length === 0 ? (
        <p className="rb-empty">
          No data yet. Build it with <code>python3 -I scripts/build_router_benchmarks.py &lt;research dir&gt;</code>.
        </p>
      ) : (
        <RouterBenchmarksTable query={sp} layout={layout} benchmarks={catalog.benchmarks} groups={catalog.groups}
                               initialNotes={state.notes} initialArchived={state.archived} />
      )}
    </main>
  );
}
