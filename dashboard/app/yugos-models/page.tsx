import type { Metadata } from "next";
import { YugosModelsTable } from "@/components/YugosModelsTable";
import { readCatalog, readState } from "@/lib/yugosModels";
import { readLayout } from "@/lib/uiLayout";
import "./yugos-models.css";

export const metadata: Metadata = { title: "Yugos models · LLM Benchmark Results" };
export const dynamic = "force-dynamic";   // re-read the catalog and saved notes on every visit

/** Every model the Yugos router may pick (the live world card), with the user's notes and watch list. */
export default async function YugosModelsPage() {
  const [catalog, state, layout] = await Promise.all([readCatalog(), readState(), readLayout("yugos-models")]);
  return (
    <main className="page wide">
      <header className="ym-header">
        <div>
          <h1>Yugos models</h1>
          <p className="subtle small">
            Every model on the Yugos{" "}
            <a href={catalog.world_card.url} target="_blank" rel="noreferrer">world card</a>
            {catalog.world_card.synced_at ? <> (synced {catalog.world_card.synced_at.slice(0, 10)})</> : null}
            : the only models a router may route to. Prices are USD per 1M tokens.
          </p>
        </div>
      </header>
      <YugosModelsTable layout={layout} models={catalog.models} initialNotes={state.notes} initialExcluded={state.excluded} sourceNotes={catalog.notes} />
    </main>
  );
}
