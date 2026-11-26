import Link from "next/link";
import { FilterBar } from "@/components/FilterBar";
import { ResultsTable, type ResultsColumn } from "@/components/ResultsTable";
import { toQuery, type FilterValues } from "@/lib/filters";
import { compareSources } from "@/lib/sourceOrder";
import { api } from "@/lib/api";
import { readLayout } from "@/lib/uiLayout";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
/** all values of a repeated parameter that are valid choices, without duplicates */
const many = (v: string | string[] | undefined, valid: Iterable<string>) => {
  const ok = new Set(valid);
  return [...new Set(v === undefined ? [] : Array.isArray(v) ? v : [v])].filter((x) => ok.has(x));
};

const PAGE_SIZES = ["25", "50", "100", "200"];

// column -> API sort key (null = not sortable)
const COLUMNS: { key: string; label: string; sort: string | null; numeric?: boolean; firstOrder?: "asc" | "desc" }[] = [
  { key: "model", label: "Model", sort: "model_name", firstOrder: "asc" },
  { key: "developer", label: "Developer", sort: "provider", firstOrder: "asc" },
  { key: "benchmark", label: "Benchmark", sort: "benchmark", firstOrder: "asc" },
  { key: "area", label: "Area", sort: "area", firstOrder: "asc" },
  { key: "effort", label: "Effort", sort: "reasoning_effort", firstOrder: "asc" },
  { key: "score", label: "Score", sort: "benchmark_score", numeric: true },
  { key: "accuracy", label: "Accuracy", sort: "accuracy", numeric: true },
  { key: "cost", label: "$ / task", sort: "cost_per_task_usd", numeric: true, firstOrder: "asc" },
  { key: "speed", label: "Tok/s", sort: "tokens_per_sec", numeric: true },
  { key: "date", label: "Date", sort: "date", numeric: true },
  { key: "source", label: "Source", sort: "source_name", firstOrder: "asc" },
];

export default async function ResultsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [options, layout] = await Promise.all([api.filters(), readLayout("results")]);
  // Source filter and the Benchmark filter's groups follow lib/sourceOrder.ts
  options.sources.sort((a, b) => compareSources(a.source_name, b.source_name));

  const sort = options.sorts.includes(one(sp.sort)) ? one(sp.sort) : "benchmark_score";
  const order = one(sp.order) === "asc" ? "asc" : "desc";
  const limit = PAGE_SIZES.includes(one(sp.limit)) ? one(sp.limit) : "50";
  const values: FilterValues = {
    q: one(sp.q).trim(),
    source_id: many(sp.source_id, options.sources.map((s) => s.id)),
    benchmark_id: many(sp.benchmark_id, options.benchmarks.map((b) => b.id)),
    area: many(sp.area, options.areas),
    provider: many(sp.provider, options.providers),
    model_id: many(sp.model_id, options.models.map((m) => m.id)),
    reasoning_effort: many(sp.reasoning_effort, [...options.reasoning_efforts, "unspecified"]),
    sort, order, limit,
  };
  const pageNo = Math.max(1, Math.floor(Number(one(sp.page)) || 1));
  const size = Number(limit);

  const data = await api.results({
    q: values.q || undefined,
    source_id: values.source_id,
    benchmark_id: values.benchmark_id,
    area: values.area,
    provider: values.provider,
    model_id: values.model_id,
    reasoning_effort: values.reasoning_effort,
    sort, order, limit: size, offset: (pageNo - 1) * size,
  });
  const pages = Math.max(1, Math.ceil(data.total / size));

  /** link to this page with some params changed (filters kept) */
  const href = (changes: { sort?: string; order?: string; limit?: string; page?: number }) => {
    const qs = new URLSearchParams(toQuery({
      ...values, sort: changes.sort ?? sort, order: changes.order ?? order, limit: changes.limit ?? limit,
    }));
    const page = changes.page ?? pageNo;
    if (page > 1) qs.set("page", String(page));
    return `/?${qs}`;
  };

  const from = data.total === 0 ? 0 : data.offset + 1;
  const to = data.offset + data.items.length;

  return (
    <main className="page">
      <header className="page-head">
        <h1>LLM benchmark results</h1>
      </header>

      <FilterBar values={values} options={options} />

      <section className="card" aria-labelledby="results-heading">
        <div className="table-head">
          <h2 id="results-heading">
            {data.total.toLocaleString("en-US")} result{data.total === 1 ? "" : "s"}
          </h2>
          <div className="row">
            <span className="muted small">Rows per page</span>
            {PAGE_SIZES.map((n) => (
              <Link key={n} href={href({ limit: n, page: 1 })} className={`chip${n === limit ? " on" : ""}`}
                    aria-current={n === limit ? "true" : undefined}>{n}</Link>
            ))}
          </div>
        </div>

        {data.items.length === 0 ? (
          <p className="empty">No results match these filters.</p>
        ) : (
          <ResultsTable items={data.items} layout={layout} columns={COLUMNS.map((c): ResultsColumn => {
            const active = c.sort === sort;
            const next = active ? (order === "desc" ? "asc" : "desc") : (c.firstOrder ?? "desc");
            return { key: c.key, label: c.label, numeric: c.numeric, active, order,
              href: c.sort ? href({ sort: c.sort, order: next, page: 1 }) : null };
          })} />
        )}

        <nav className="pager" aria-label="Pages">
          <span className="muted small">
            {from.toLocaleString("en-US")}–{to.toLocaleString("en-US")} of {data.total.toLocaleString("en-US")}
          </span>
          <div className="row">
            <PageLink href={href({ page: 1 })} disabled={pageNo <= 1}>« First</PageLink>
            <PageLink href={href({ page: pageNo - 1 })} disabled={pageNo <= 1}>‹ Prev</PageLink>
            <span className="small">Page {Math.min(pageNo, pages)} of {pages}</span>
            <PageLink href={href({ page: pageNo + 1 })} disabled={pageNo >= pages}>Next ›</PageLink>
            <PageLink href={href({ page: pages })} disabled={pageNo >= pages}>Last »</PageLink>
          </div>
        </nav>
        <p className="muted small note">
          * Artificial Analysis publishes no evaluation dates; those rows show the date the data was collected.
          Scores are on a 0–100 scale; compare them within one benchmark. Scores published on another scale
          are converted, with the original number shown in grey before it: head-to-head ratings (Elo) become the chance of beating
          an average model of the same arena, 100 / (1 + 10^((average rating − rating) / 400)); other ranges are
          rescaled to 0–100. Counts and “lower is better” scores cannot be converted: they keep their own number,
          are marked, and sort after the others. Accuracy (share of questions
          answered correctly) is shown only where the publisher reports its score as accuracy.
        </p>
      </section>
    </main>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  return disabled
    ? <span className="button disabled" aria-disabled="true">{children}</span>
    : <Link className="button" href={href}>{children}</Link>;
}
