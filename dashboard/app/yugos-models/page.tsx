import type { Metadata } from "next";
import { YugosModelsTable } from "@/components/YugosModelsTable";
import { readCatalog, readModelLinks, readState } from "@/lib/yugosModels";
import { api, type ModelCoverage } from "@/lib/api";
import { readLayout } from "@/lib/uiLayout";
import { readArchive } from "@/lib/archive";
import "./yugos-models.css";

export const metadata: Metadata = { title: "Yugos models · LLM Benchmark Results" };
export const dynamic = "force-dynamic";   // re-read the catalog and saved notes on every visit

/** Every model the Yugos router may pick (the live world card), with the user's notes and watch list. */
export default async function YugosModelsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;   // view state (filters, view, grouping, sort) lives in the URL
  const [catalog, state, layout, links, archived, coverage] = await Promise.all([
    readCatalog(), readState(), readLayout("yugos-models"), readModelLinks(), readArchive("yugos-models"),
    api.models().catch((): ModelCoverage[] => []),      // API down: the page still works, without coverage
  ]);
  // each Yugos model's project model ID (registry) and how much benchmark data it has (database)
  const byKey = new Map(coverage.map((c) => [c.canonical_key, c]));
  const models = catalog.models.map((m) => {
    const l = links[m.model];
    const c = l ? byKey.get(l.modelId) : undefined;
    return { ...m, model_id: l?.modelId, model_link: l?.link ?? "none", model_uuid: c?.id,
             results: c?.result_count ?? 0, benchmarks: c?.benchmark_count ?? 0 };
  });
  return (
    <main className="page wide">
      <header className="ym-header">
        <div>
          <h1>Yugos models</h1>
          <p className="page-lead">
            Every model on the Yugos{" "}
            <a href={catalog.world_card.url} target="_blank" rel="noreferrer">world card</a>
            {catalog.world_card.synced_at ? <> (synced {catalog.world_card.synced_at.slice(0, 10)})</> : null}
            : the only models a router may route to. Prices are USD per 1M tokens.
          </p>
        </div>
      </header>
      <YugosModelsTable archived={archived} query={sp} layout={layout} models={models} initialNotes={state.notes} initialExcluded={state.excluded} sourceNotes={catalog.notes} />
    </main>
  );
}
