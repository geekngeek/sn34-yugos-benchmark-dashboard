"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { MultiSelect, type Option } from "@/components/MultiSelect";
import { EMPTY_FILTERS, LIST_FILTERS, toQuery, type FilterValues } from "@/lib/filters";
import type { FilterOptions } from "@/lib/types";
import { benchmarkTitle, effortLabel } from "@/lib/format";

const results = (n: number) => `${n.toLocaleString("en-US")} result${n === 1 ? "" : "s"}`;

/** benchmarks grouped under their source (sources in display order); a heading selects the whole source */
function sourceBenchmarkOptions(options: FilterOptions): Option[] {
  const order = new Map(options.sources.map((s, i) => [s.source_name, i]));
  const sourceId = new Map(options.sources.map((s) => [s.source_name, s.id]));
  return options.benchmarks
    .map((b) => ({ value: b.id, label: benchmarkTitle(b.benchmark_name, b.benchmark_version),
                   group: b.sources[0] ?? "Other", groupValue: sourceId.get(b.sources[0]), hint: results(b.result_count) }))
    .sort((x, y) => (order.get(x.group) ?? 999) - (order.get(y.group) ?? 999)
                    || x.label.localeCompare(y.label, "en", { sensitivity: "base" }));
}

/** models grouped under their developer (A-Z); a heading selects the whole developer */
function developerModelOptions(options: FilterOptions): Option[] {
  return options.models.map((m) => ({ value: m.id, label: m.model_name, group: m.provider, groupValue: m.provider,
                                      hint: results(m.result_count) }));
}

/** catch-all choices go last: "other" area; effort "no reasoning" and "not stated" */
const LAST_AREAS = ["other"];
const LAST_EFFORTS = ["none"];
const lastly = (list: string[], last: string[]) => [...list.filter((x) => !last.includes(x)), ...last.filter((x) => list.includes(x))];

/**
 * Filters update the URL (and so the server-rendered table) as you change them.
 * Each filter takes several values (any of them matches); different filters combine
 * (all must match). Source/Benchmark and Developer/Model are one dropdown each: a
 * heading selects the whole source or developer, and single items can be added.
 */
export function FilterBar({ values, options }: { values: FilterValues; options: FilterOptions }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState(values);
  // false until React takes over: until then the visible Apply button submits the plain GET form
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // follow external changes (Clear, back/forward, sort links)
  const valuesKey = toQuery(values);
  useEffect(() => setState(values), [valuesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const go = (next: FilterValues) => {
    if (timer.current) clearTimeout(timer.current);
    startTransition(() => router.push(`/?${toQuery(next)}`, { scroll: false }));
  };
  const update = (next: FilterValues, debounce = false) => {
    setState(next);
    if (debounce) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => go(next), 400);
    } else {
      go(next);
    }
  };


  const active = Boolean(state.q || LIST_FILTERS.some((k) => state[k].length));

  return (
    <form method="get" action="/" className="filters" role="search" aria-label="Filter results"
          data-interactive={interactive ? "true" : "false"}
          onSubmit={(e) => { e.preventDefault(); go(state); }}>
      <div className="field grow">
        <label htmlFor="q">Search</label>
        <input id="q" name="q" type="search" value={state.q} placeholder="Model, developer, benchmark"
               autoComplete="off" onChange={(e) => update({ ...state, q: e.target.value }, true)} />
      </div>

      <MultiSelect id="benchmark_id" label="Source / Benchmark" allLabel="All sources"
                   selected={state.benchmark_id} selectedGroups={state.source_id}
                   onChange={(benchmarks, sources) => update({ ...state, benchmark_id: benchmarks, source_id: sources })}
                   options={sourceBenchmarkOptions(options)} />

      <MultiSelect id="model_id" label="Developer / Model" allLabel="All models"
                   selected={state.model_id} selectedGroups={state.provider}
                   onChange={(models, developers) => update({ ...state, model_id: models, provider: developers })}
                   options={developerModelOptions(options)} />

      <MultiSelect id="area" label="Area" allLabel="All areas" selected={state.area}
                   onChange={(v) => update({ ...state, area: v })}
                   options={lastly(options.areas, LAST_AREAS).map((a) => ({ value: a, label: a }))} />

      <MultiSelect id="reasoning_effort" label="Reasoning effort" allLabel="Any effort" selected={state.reasoning_effort}
                   onChange={(v) => update({ ...state, reasoning_effort: v })}
                   options={[...lastly(options.reasoning_efforts, LAST_EFFORTS).map((e) => ({ value: e, label: effortLabel(e) })),
                             { value: "unspecified", label: "not stated" }]} />

      {/* keep the current choices in a plain form submit (no-JavaScript fallback) */}
      {LIST_FILTERS.flatMap((k) => state[k].map((v) => <input key={`${k}:${v}`} type="hidden" name={k} value={v} />))}
      <input type="hidden" name="sort" value={state.sort} />
      <input type="hidden" name="order" value={state.order} />
      <input type="hidden" name="limit" value={state.limit} />
      {!interactive && <button type="submit" className="button primary">Apply</button>}
      {active && (
        <button type="button" className="button" onClick={() => go({ ...state, ...EMPTY_FILTERS })}>Clear</button>
      )}
      <span className="status muted small" role="status" aria-live="polite">{pending ? "Updating…" : ""}</span>
    </form>
  );
}
