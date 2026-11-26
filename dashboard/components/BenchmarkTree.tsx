"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { HoverTip } from "@/components/HoverTip";
import { Stars } from "@/components/Stars";
import { difficultyText, LEVEL_HELP, LEVEL_NAMES, type Difficulty } from "@/lib/difficulty";
import { MultiSelect } from "@/components/MultiSelect";
import { TOPICS, TOPIC_LABEL, parentTopics, subTopics } from "@/lib/benchmarkTopics";
import { qFlag, qMany, qOne, useQuerySync, type Query } from "@/lib/urlState";
import { ResetColumns, useColumnLayout, type ColDef, type SavedLayout } from "@/lib/columnLayout";
import { METRIC_INFO, METRIC_KEYS, reportedKeys, type MetricKey, type Metrics } from "@/lib/metrics";

export interface TreeItem {
  difficulty: Difficulty;   // level 1..5 (research), see lib/difficulty.ts
  no: string;
  name: string;
  yugos: string;
  category: string;
  url: string;
  focus: string;
  top: string;          // "1. Model (score)\n2. …" or free text
  yugosUse: string;
  notes: string;        // research caveats
  myNotes: string;      // editable
  metrics: Metrics;     // reporting parameters (parent benchmarks)
  extra: [string, string][];   // any other CSV columns
  children: TreeItem[];
}

interface Ranked { name: string; score: string }

/** "1. Model (score)" lines -> [{name, score}]; null when the text isn't such a list */
function parseTop(text: string): Ranked[] | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const out: Ranked[] = [];
  for (const l of lines) {
    const m = l.match(/^\d+\.\s*(.*?)(?:\s*\(([^()]*)\))?\s*[;,]?$/);
    if (!m) return null;
    out.push({ name: m[1], score: m[2] ?? "" });
  }
  return out;
}

const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
const yes = (v: string) => v.trim().toLowerCase() === "yes";

/**
 * The benchmark list as a compact tree: one line per benchmark, sub-benchmarks indented under
 * their parent. The selected row's full details and its editable note show in the side panel.
 * Keys: ↑/↓ move, → open / go to first child, ← close / go to parent, / search.
 */
// tree columns: default order and widths (px); dragged and resized by the user, saved on the server
const TREE_COLS: ColDef[] = [
  { key: "no", width: 46, min: 30, fixed: true }, { key: "name", width: 270, min: 120 }, { key: "yugos", width: 60, min: 40, fixed: true }, { key: "difficulty", width: 92, min: 80, fixed: true },
  { key: "category", width: 110 }, { key: "focus", width: 220 }, { key: "top", width: 300 },
  { key: "reports", width: 300 }, { key: "link", width: 28, min: 22, fixed: true }, { key: "notes", width: 28, min: 22, fixed: true },
];
const TREE_HEADS: Record<string, { label: string; cls?: string; title?: string; aria?: string }> = {
  no: { label: "No", cls: "c-no" }, name: { label: "Benchmark" }, yugos: { label: "Yugos", cls: "c-yug", title: "Used by Yugos" },
  difficulty: { label: "Difficulty", title: "Difficulty level 1-5 from published scores (hover a row's stars for details)" },
  category: { label: "Category" }, focus: { label: "Focus" }, top: { label: "Top ranked" },
  reports: { label: "Reports", title: "Parameters the benchmark reports besides its score" },
  link: { label: "", cls: "c-ico", aria: "Link" }, notes: { label: "", cls: "c-ico", aria: "Notes" },
};

export function BenchmarkTree({ items, expandAll = false, initialView = "tree", layout, query: initialQuery }: { items: TreeItem[]; expandAll?: boolean; initialView?: "tree" | "params"; layout?: SavedLayout; query?: Query }) {
  const cl = useColumnLayout("benchmark-list", TREE_COLS, layout);
  const [tree, setTree] = useState(items);
  const [open, setOpen] = useState<Set<string>>(() => new Set(expandAll ? items.filter((p) => p.children.length).map((p) => p.no) : []));
  // every filter and the view start from the URL (?q=&yugos=1&notes=1&cat=…&param=…&site=1&view=params) and are written back to it
  const [query, setQuery] = useState(() => qOne(initialQuery, "q"));
  const [onlyYugos, setOnlyYugos] = useState(() => qFlag(initialQuery, "yugos"));
  const [onlyNoted, setOnlyNoted] = useState(() => qFlag(initialQuery, "notes"));
  // filters on the benchmark (parent) rows; a parent that passes keeps its sub-benchmarks
  const [cats, setCats] = useState<string[]>(() => qMany(initialQuery, "cat"));      // sub-benchmarks in any of these categories
  // difficulty levels 1..5 (?diff=3&diff=4): sub-benchmarks whose level (or range of levels) includes a checked one
  const [levels, setLevels] = useState<number[]>(() => qMany(initialQuery, "diff").map(Number).filter((n) => n >= 1 && n <= 5));
  const [params, setParams] = useState<string[]>(() => qMany(initialQuery, "param")); // benchmark must report all of these parameters
  const [onSiteOnly, setOnSiteOnly] = useState(() => qFlag(initialQuery, "site"));    // …shown on the benchmark's own page
  const [selected, setSelected] = useState<string>(items[0]?.no ?? "");
  const [view, setView] = useState<"tree" | "params">(initialView);
  // details panel: closed gives the table the full width; remembered between visits
  const [panel, setPanelState] = useState(true);
  useEffect(() => { if (localStorage.getItem("bl-panel") === "closed") setPanelState(false); }, []);
  const setPanel = (on: boolean) => { setPanelState(on); localStorage.setItem("bl-panel", on ? "open" : "closed"); };
  // details panel width: drag its left edge; remembered between visits
  const [panelW, setPanelW] = useState(PANEL_DEFAULT);
  useEffect(() => { const w = Number(localStorage.getItem("bl-panel-w")); if (w) setPanelW(clampPanel(w)); }, []);
  const resizePanel = useCallback((w: number, save = false) => {
    const c = clampPanel(w); setPanelW(c); if (save) localStorage.setItem("bl-panel-w", String(c));
  }, []);
  const listRef = useRef<HTMLDivElement>(null);
  // the grid element is both the keyboard list and the box the columns share (stable, so the size observer isn't rebuilt each render)
  const gridRef = useCallback((el: HTMLDivElement | null) => { (listRef as React.MutableRefObject<HTMLDivElement | null>).current = el; cl.root(el); }, [cl.root]);
  const searchRef = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const textFiltering = q !== "" || onlyNoted;
  const filtering = textFiltering || cats.length > 0 || levels.length > 0;   // filtered rows show their matching sub-benchmarks, open
  const text = (i: TreeItem) => [i.name, i.category, i.focus, i.top, i.yugosUse, i.notes, i.myNotes, i.url,
    ...i.metrics.params.map((m) => `${m.key} ${METRIC_INFO[m.key].title} ${m.label} ${m.detail}`)].join(" ").toLowerCase();
  const match = (i: TreeItem) => (!q || text(i).includes(q)) && (!onlyNoted || i.myNotes.trim() !== "");
  // a sub-benchmark's topics (lib/benchmarkTopics.ts): from its name, else its focus, else its parent
  const topicsOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of tree) for (const c of p.children) m.set(c.no, subTopics(c, p).topics);
    return m;
  }, [tree]);
  // Category filters sub-benchmarks by their own category; Reports filters the benchmark (parent) itself
  const levelOk = (c: TreeItem) => !levels.length || ((c.difficulty.kind === "firm" || c.difficulty.kind === "range")
    && levels.some((L) => L >= c.difficulty.lo && L <= c.difficulty.hi));      // "2-3" counts for 2 and for 3
  const kidOk = (c: TreeItem) => (!cats.length || (topicsOf.get(c.no) ?? []).some((t) => cats.includes(t))) && levelOk(c);
  const subFiltered = cats.length > 0 || levels.length > 0;
  const passes = (p: TreeItem) => {
    if (!params.length) return true;
    const got = reportedKeys(p.metrics);
    return params.every((k) => got.some((r) => r.key === k && (!onSiteOnly || r.where === "page")));
  };
  const narrowed = cats.length > 0 || params.length > 0 || levels.length > 0;
  const levelCounts = useMemo(() => [0, 1, 2, 3, 4, 5].map((L) => tree.reduce((n, p) => n + p.children.filter((c) =>
    (c.difficulty.kind === "firm" || c.difficulty.kind === "range") && L >= c.difficulty.lo && L <= c.difficulty.hi).length, 0)), [tree]);
  useQuerySync({ q: query.trim(), yugos: onlyYugos, notes: onlyNoted, cat: cats, diff: levels.map(String), param: params, site: onSiteOnly && params.length > 0,
                 view: view === "params" ? "params" : null });

  // visible rows in order; while filtering, parents with matching children are shown open
  const visible = useMemo(() => {
    const rows: { item: TreeItem; depth: number; parent?: TreeItem; shownKids: number }[] = [];
    for (const p of tree) {
      if (onlyYugos && !yes(p.yugos)) continue;
      if (!passes(p)) continue;
      const base = subFiltered ? p.children.filter(kidOk) : p.children;
      if (subFiltered && base.length === 0) continue;
      const kids = textFiltering ? (match(p) && !onlyNoted && q ? base : base.filter(match)) : base;
      if (textFiltering && !match(p) && kids.length === 0) continue;
      rows.push({ item: p, depth: 0, shownKids: kids.length });
      if (filtering ? kids.length > 0 : open.has(p.no)) for (const c of kids) rows.push({ item: c, depth: 1, parent: p, shownKids: 0 });
    }
    return rows;
  }, [tree, open, q, onlyYugos, onlyNoted, cats, levels, params, onSiteOnly, topicsOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const byNo = useMemo(() => {
    const m = new Map<string, { item: TreeItem; parent?: TreeItem }>();
    for (const p of tree) { m.set(p.no, { item: p }); for (const c of p.children) m.set(c.no, { item: c, parent: p }); }
    return m;
  }, [tree]);
  const current = byNo.get(selected);

  const toggle = (no: string, to?: boolean) => setOpen((s) => {
    const n = new Set(s); const want = to ?? !n.has(no);
    if (want) n.add(no); else n.delete(no);
    return n;
  });
  const parentsWithKids = tree.filter((p) => p.children.length).map((p) => p.no);
  // topics with how many sub-benchmarks (in how many benchmarks) have each
  const catOptions = useMemo(() => {
    const n = new Map<string, { subs: number; in: Set<string> }>();
    for (const p of tree) for (const c of p.children) for (const t of topicsOf.get(c.no) ?? []) {
      const e = n.get(t) ?? { subs: 0, in: new Set<string>() };
      e.subs += 1; e.in.add(p.name);
      n.set(t, e);
    }
    return TOPICS.filter((t) => n.has(t.id)).map((t) => {
      const e = n.get(t.id)!;
      return { value: t.id, label: t.label, hint: `${e.subs} · ${e.in.size} bench`,
               title: `${t.label}: ${e.subs} sub-benchmarks in ${e.in.size} benchmarks (${[...e.in].slice(0, 6).join(", ")}${e.in.size > 6 ? ", …" : ""})` };
    });
  }, [tree, topicsOf]);
  const paramOptions = useMemo(() => METRIC_KEYS.map((k: MetricKey) => {
    const all = tree.filter((p) => reportedKeys(p.metrics).some((r) => r.key === k)).length;
    const page = tree.filter((p) => reportedKeys(p.metrics).some((r) => r.key === k && r.where === "page")).length;
    return { value: k, label: METRIC_INFO[k].title, hint: `${all} · ${page} on site`, title: `${METRIC_INFO[k].help}: ${all} benchmarks report it, ${page} on the site itself`, all };
  }).filter((o) => o.all > 0), [tree]);
  const shownParents = visible.filter((r) => r.depth === 0).length;
  const subTotal = tree.reduce((n, p) => n + p.children.length, 0);

  // keep the selected row in view when moving with the keyboard
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-no="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = visible.findIndex((r) => r.item.no === selected);
    const row = visible[at];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = visible[Math.min(visible.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) setSelected(next.item.no);
    } else if (e.key === "ArrowRight" && row) {
      e.preventDefault();
      if (row.depth === 0 && row.item.children.length) {
        if (!filtering && !open.has(row.item.no)) toggle(row.item.no, true);
        else if (visible[at + 1]?.depth === 1) setSelected(visible[at + 1].item.no);
      }
    } else if (e.key === "ArrowLeft" && row) {
      e.preventDefault();
      if (row.depth === 1 && row.parent) setSelected(row.parent.no);
      else if (!filtering) toggle(row.item.no, false);
    } else if (e.key === "Enter" && row?.depth === 0 && !filtering) {
      e.preventDefault(); toggle(row.item.no);
    } else if (e.key === "/") {
      e.preventDefault(); searchRef.current?.focus();
    }
  };

  const updateNote = (no: string, note: string) =>
    setTree((t) => t.map((p) => p.no === no ? { ...p, myNotes: note }
      : { ...p, children: p.children.map((c) => (c.no === no ? { ...c, myNotes: note } : c)) }));

  return (
    <HoverTip className="bl">
      <div className="bl-tools">
        <div className="bl-seg" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view === "tree"} className={view === "tree" ? "on" : ""} onClick={() => setView("tree")}>Tree</button>
          <button type="button" role="tab" aria-selected={view === "params"} className={view === "params" ? "on" : ""} onClick={() => setView("params")}>Parameters</button>
        </div>
        <input ref={searchRef} type="search" className="bl-search" placeholder="Search names, models, notes…  ( / )"
               value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the benchmark list" />
        <label className="bl-toggle"><input type="checkbox" checked={onlyYugos} onChange={(e) => setOnlyYugos(e.target.checked)} /> Yugos only</label>
        <label className="bl-toggle"><input type="checkbox" checked={onlyNoted} onChange={(e) => setOnlyNoted(e.target.checked)} /> With my notes</label>
        <span className="muted small">{tree.length} benchmarks · {subTotal} sub-benchmarks</span>
        {!panel && <button type="button" className="button bl-showpanel" onClick={() => setPanel(true)}
                           title="Show the details panel (or click a row)">◧ Details</button>}
        {view === "tree" && <ResetColumns layout={cl} />}
        {view === "tree" && <span className="row bl-expand">
          <button type="button" className="link" disabled={filtering || open.size === parentsWithKids.length}
                  onClick={() => setOpen(new Set(parentsWithKids))}>Expand all</button>
          <button type="button" className="link" disabled={filtering || open.size === 0}
                  onClick={() => setOpen(new Set())}>Collapse all</button>
        </span>}
      </div>

      <p className="bl-legend small">
        {view === "params" ? (
          <><b>●</b> On the site: read it off the leaderboard.
            <span className="bl-legsep" /><b>○</b> Official, but only in a data file or the paper: download or read it to get it.
            <span className="bl-legsep" /><b className="m-no">·</b> Not reported.</>
        ) : (
          <><span className="bl-tag t-cost">$</span> Reports: solid tag = on the site.
            <span className="bl-legsep" /><span className="bl-tag t-cost faint">$</span> dashed = official, but only in a data file or the paper.</>
        )}
      </p>
      <div className="bl-filters" role="group" aria-label="Filter benchmarks">
        <MultiSelect id="bl-category" label="Sub-benchmark category" allLabel="All categories" options={catOptions} selected={cats.filter((c) => TOPIC_LABEL[c])}
                     onChange={(v) => setCats(v)} />
        <MultiSelect id="bl-params" label="Reports (all of)" allLabel="Any parameters" options={paramOptions} selected={params}
                     onChange={(v) => setParams(v)} />
        <label className="bl-toggle" title="Count a parameter only when the benchmark's own page shows it (not just its data file or paper)">
          <input type="checkbox" checked={onSiteOnly} onChange={(e) => setOnSiteOnly(e.target.checked)} disabled={!params.length} /> Shown on the site only
        </label>
        <MultiSelect id="bl-diff" label="Difficulty" allLabel="Any difficulty" listAll
                     options={[1, 2, 3, 4, 5].map((L) => ({ value: String(L), label: `${L} · ${LEVEL_NAMES[L]}`, short: `${L} ${LEVEL_NAMES[L]}`,
                       hint: `${levelCounts[L]}`, title: `${LEVEL_HELP[L]} (a range such as 2-3 counts for each level it covers)` }))}
                     selected={levels.map(String)} onChange={(v) => setLevels(v.map(Number).sort())} />
        {narrowed && <>
          <span className="small">{shownParents} of {tree.length} benchmarks</span>
          <button type="button" className="link" onClick={() => { setCats([]); setParams([]); setOnSiteOnly(false); setLevels([]); }}>Clear filters</button>
        </>}
      </div>

      <div className={`bl-body${panel ? "" : " full"}`} style={{ "--bl-panel-w": `${panelW}px` } as React.CSSProperties}>
        {view === "params" ? (
          <ParamsGrid items={visible.filter((r) => r.depth === 0).map((r) => r.item)} selected={selected} onSelect={(no) => { setSelected(no); setPanel(true); }} onOpen={() => setPanel(true)} />
        ) : (
        <div className="bl-grid" role="treegrid" aria-label="Benchmarks" tabIndex={0} ref={gridRef} onKeyDown={onKey}
             style={{ ["--bl-cols" as string]: cl.cols.map((c) => `${cl.width(c.key)}px`).join(" ") }}
             aria-activedescendant={selected ? `bl-${selected}` : undefined}>
          <div className="bl-row bl-head" role="row">
            {cl.cols.map(({ key }) => {
              const h = TREE_HEADS[key];
              const hp = cl.head(key);
              return (
                <span key={key} role="columnheader" {...hp} className={`${hp.className}${h.cls ? ` ${h.cls}` : ""}`}
                      title={h.title} aria-label={h.aria}>{h.label}{cl.grip(key)}</span>
              );
            })}
          </div>
          {visible.length === 0 && <div className="bl-empty muted">
            {onlyNoted && !tree.some((p) => p.myNotes.trim() || p.children.some((c) => c.myNotes.trim()))
              ? "No benchmark has a note of yours yet: select a row and write one under My notes in the details panel."
              : "No matches. Clear a filter to see more."}</div>}
          {visible.map(({ item: i, depth, shownKids }, vi) => {
            const isOpen = depth === 0 && (filtering ? shownKids > 0 : open.has(i.no));
            const ranked = parseTop(i.top);
            const cells: Record<string, () => React.ReactNode> = {
              difficulty: () => (
                  <span key="difficulty" className="c-diff" title={i.difficulty.kind === "none" ? "" : `${difficultyText(i.difficulty)}${depth === 0 && i.children.length ? " (range of its sub-benchmarks)" : ""}`}>
                    <Stars d={i.difficulty} span={depth === 0 && i.children.length > 0} />
                  </span>
              ),
              no: () => (
                  <span key="no" className="c-no num">{i.no}</span>
              ),
              name: () => (
                  <span key="name" className="c-name">
                    {depth === 0 ? (
                      i.children.length ? (
                        <button type="button" className="bl-caret" aria-label={isOpen ? "Collapse" : "Expand"} disabled={filtering}
                                onClick={(e) => { e.stopPropagation(); setSelected(i.no); toggle(i.no); }}>{isOpen ? "▾" : "▸"}</button>
                      ) : <span className="bl-caret" />
                    ) : <span className="bl-guide" aria-hidden="true" />}
                    <span className="bl-label" data-tip>
                      <Link href={`/benchmarks/${encodeURIComponent(i.no)}`} className="bl-name-link"
                            onClick={(e) => e.stopPropagation()} title={`Open ${i.name}`}>{i.name}</Link>
                    </span>
                    {depth === 0 && i.children.length > 0 && (
                      <span className="bl-count">{filtering && shownKids !== i.children.length ? `${shownKids}/` : ""}{i.children.length}</span>
                    )}
                  </span>
              ),
              yugos: () => (
                  <span key="yugos" className="c-yug">{yes(i.yugos) ? <span className="bl-yes">Yes</span> : depth === 0 && i.yugos ? <span className="muted">No</span> : null}</span>
              ),
              category: () => (
                  <span key="category" className="c-cat" data-tip>{i.category}</span>
              ),
              focus: () => (
                  <span key="focus" className="c-focus" data-tip>{i.focus}</span>
              ),
              top: () => (
                  <span key="top" className="c-top" data-tip>
                    {ranked ? ranked.map((r, k) => (
                      <Fragment key={k}>
                        {k > 0 && <span className="bl-sep">·</span>}
                        <span className={k === 0 ? "bl-first" : undefined}>{r.name}</span>
                        {r.score && <span className="bl-score">{r.score}</span>}
                      </Fragment>
                    )) : <span className="muted">{i.top.replace(/\s*\n\s*/g, " ")}</span>}
                  </span>
              ),
              reports: () => (
                  <span key="reports" className="c-rep" data-tip>{depth === 0 && <ReportTags item={i} />}</span>
              ),
              link: () => (
                  <span key="link" className="c-ico">
                    {/^https?:\/\//.test(i.url) && (
                      <a href={i.url} target="_blank" rel="noreferrer" title={i.url} aria-label={`Open ${i.name}`}
                         onClick={(e) => e.stopPropagation()}>↗</a>
                    )}
                  </span>
              ),
              notes: () => (
                  <span key="notes" className="c-ico">
                    {i.myNotes.trim() ? <span className="bl-mine" title="Has my note">✎</span>
                      : i.notes.trim() ? <span className="bl-info" title="Has research notes (see details)">i</span> : null}
                  </span>
              ),
            };
            return (
              <div key={i.no} id={`bl-${i.no}`} data-no={i.no} role="row" aria-level={depth + 1}
                   aria-expanded={depth === 0 && i.children.length ? isOpen : undefined} aria-selected={selected === i.no}
                   className={`bl-row ${depth ? "sub" : "parent"}${selected === i.no ? " sel" : ""}${isOpen ? " open" : ""}${vi % 2 ? " zb" : ""}`}
                   onClick={() => { setSelected(i.no); setPanel(true); }}>
                {cl.cols.map((c) => cells[c.key]())}
              </div>
            );
          })}
        </div>
        )}

        {panel && current && <Details key={current.item.no} item={current.item} parent={current.parent} onClose={() => setPanel(false)}
                             width={panelW} onResize={resizePanel}
                             onSaved={(note) => updateNote(current.item.no, note)}
                             onPick={(no) => { setSelected(no); if (byNo.get(no)?.parent) toggle(byNo.get(no)!.parent!.no, true); }} />}
      </div>
    </HoverTip>
  );
}

const PANEL_DEFAULT = 360;
const clampPanel = (w: number) =>
  Math.round(Math.max(260, Math.min(w, typeof window === "undefined" ? 900 : Math.max(260, window.innerWidth * 0.6))));

/** drag handle on the panel's left edge: drag, ←/→ keys, double-click resets */
function PanelResizer({ width, onResize }: { width: number; onResize: (w: number, save?: boolean) => void }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <div className="bl-resize" role="separator" aria-orientation="vertical" aria-label="Resize the details panel"
         aria-valuenow={width} tabIndex={0} title="Drag to resize · double-click to reset"
         onPointerDown={(e) => { start.current = { x: e.clientX, w: width }; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); }}
         onPointerMove={(e) => { if (start.current) onResize(start.current.w + (start.current.x - e.clientX)); }}
         onPointerUp={(e) => { if (start.current) { onResize(start.current.w + (start.current.x - e.clientX), true); start.current = null; } }}
         onPointerCancel={() => { start.current = null; }}
         onDoubleClick={() => onResize(PANEL_DEFAULT, true)}
         onKeyDown={(e) => {
           if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); onResize(width + (e.key === "ArrowLeft" ? 24 : -24), true); }
         }} />
  );
}

function Details({ item, parent, onSaved, onPick, onClose, width, onResize }: {
  width: number; onResize: (w: number, save?: boolean) => void;
  item: TreeItem; parent?: TreeItem; onSaved: (note: string) => void; onPick: (no: string) => void; onClose: () => void;
}) {
  const ranked = parseTop(item.top);
  const [draft, setDraft] = useState(item.myNotes);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const dirty = draft.trim() !== item.myNotes.trim();

  const save = async () => {
    if (!dirty || state === "saving") return;
    setState("saving");
    try {
      const res = await fetch("/api/benchmark-notes", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ no: item.no, name: item.name, note: draft }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      onSaved(draft.trim()); setState("saved");
    } catch (e) { setError((e as Error).message); setState("error"); }
  };

  return (
    <aside className="bl-detail" aria-label={`Details: ${item.name}`}>
      <PanelResizer width={width} onResize={onResize} />
      <button type="button" className="bl-close" onClick={onClose} aria-label="Close the details panel"
              title="Close (full-width table)">×</button>
      <div className="bl-crumb small muted">
        {parent ? <><button type="button" className="link" onClick={() => onPick(parent.no)}>{parent.name}</button> › {item.no}</> : `No ${item.no}`}
      </div>
      <h2 className="bl-title">{item.name}</h2>
      <div className="row small">
        {item.category && <span className="chip">{item.category}</span>}
        {yes(item.yugos) && <span className="bl-yes">Used by Yugos</span>}
        {item.children.length > 0 && <span className="muted">{item.children.length} sub-benchmarks</span>}
      </div>
      {/^https?:\/\//.test(item.url) && (
        <a className="bl-url small" href={item.url} target="_blank" rel="noreferrer">{shortUrl(item.url)} ↗</a>
      )}

      {item.difficulty.kind !== "none" && (
        <Field label="Difficulty">
          <p className="row"><Stars d={item.difficulty} span={item.children.length > 0} /> <b>{difficultyText(item.difficulty)}</b></p>
          {item.difficulty.kind !== "na" && item.difficulty.lo === item.difficulty.hi && <p className="small subtle">{LEVEL_HELP[item.difficulty.lo]}</p>}
          {item.difficulty.detail && <p className="pre small subtle">{item.difficulty.detail}</p>}
        </Field>
      )}
      {item.focus && <Field label="Focus"><p>{item.focus}</p></Field>}
      {(() => {   // the topics the category filter uses, and where they came from
        const t = parent ? subTopics(item, parent) : { topics: parentTopics(item), from: "name" as const };
        if (!t.topics.length) return null;
        return (
          <Field label="Topics (category filter)">
            <p>{t.topics.map((id) => TOPIC_LABEL[id]).join(" · ")}
              {parent && <span className="muted small"> — from its {t.from === "parent" ? "parent benchmark" : t.from}</span>}</p>
          </Field>
        );
      })()}
      {item.top.trim() && (
        <Field label="Top ranked models">
          {ranked ? (
            <ol className="bl-rank">
              {ranked.map((r, k) => <li key={k}><span>{r.name}</span>{r.score && <span className="bl-score">{r.score}</span>}</li>)}
            </ol>
          ) : <p className="pre">{item.top}</p>}
        </Field>
      )}
      <ReportsField item={parent ?? item} inherited={!!parent} />
      {item.yugosUse.trim() && <Field label="Yugos use?"><p className="pre">{item.yugosUse}</p></Field>}
      {item.notes.trim() && <Field label="Notes (research)"><p className="pre small subtle">{item.notes}</p></Field>}
      {item.extra.filter(([, v]) => v.trim()).map(([k, v]) => <Field key={k} label={k}><p className="pre">{v}</p></Field>)}

      <Field label="My notes">
        <textarea className="bl-note" rows={4} value={draft} placeholder="Add a note…  (Ctrl+Enter to save)"
                  onChange={(e) => { setDraft(e.target.value); setState("idle"); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); } }}
                  onBlur={() => void save()} />
        <div className="row small bl-note-bar">
          <button type="button" className="button" disabled={!dirty || state === "saving"} onClick={() => void save()}>Save</button>
          <span className={state === "error" ? "bl-err" : "muted"} role="status">
            {state === "saving" ? "Saving…" : state === "saved" ? "Saved to the CSV" : state === "error" ? `Not saved: ${error}` : dirty ? "Unsaved changes" : ""}
          </span>
        </div>
      </Field>

      {item.children.length > 0 && (
        <Field label="Sub-benchmarks">
          <ul className="bl-kids">
            {item.children.map((c) => (
              <li key={c.no}><button type="button" className="link" onClick={() => onPick(c.no)}>{c.name}</button></li>
            ))}
          </ul>
        </Field>
      )}
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <section className="bl-field"><h3>{label}</h3>{children}</section>;
}

const WHERE_TEXT = { page: "shown on the page", data: "in the official data file only", paper: "in the paper only" };

/** compact tags for the parameters a benchmark reports (its score is always reported, so not shown) */
function ReportTags({ item }: { item: TreeItem }) {
  const keys = reportedKeys(item.metrics).filter((k) => k.key !== "quality" && k.key !== "other");
  if (!item.metrics.params.length) return null;
  return (
    <>
      {keys.map(({ key, where }) => (
        <span key={key} className={`bl-tag t-${key}${where === "page" ? "" : " faint"}`}>
          {METRIC_INFO[key].short}
        </span>
      ))}
      {keys.length === 0 && <span className="muted">score only</span>}
    </>
  );
}

function ReportsField({ item, inherited }: { item: TreeItem; inherited: boolean }) {
  const m = item.metrics;
  if (!m.params.length && !m.notReported.length) return null;
  return (
    <Field label={inherited ? `Reports (as ${item.name})` : "Reports"}>
      <ul className="bl-params">
        {METRIC_KEYS.flatMap((k) => m.params.filter((p) => p.key === k)).map((p, n) => (
          <li key={n}>
            <span className={`bl-tag t-${p.key}${p.where === "page" ? "" : " faint"}`}>{METRIC_INFO[p.key].title}</span>
            <span className="bl-param">
              <b>{p.label}</b>{p.detail && <span className="subtle"> — {p.detail}</span>}
              {p.where !== "page" && <span className="muted"> ({WHERE_TEXT[p.where]})</span>}
              {p.evidence && <> <a href={p.evidence} target="_blank" rel="noreferrer" className="bl-ev" title={p.evidence}>source ↗</a></>}
            </span>
          </li>
        ))}
      </ul>
      {m.notReported.length > 0 && (
        <p className="small muted bl-notrep">Not reported: {m.notReported.map((k) => METRIC_INFO[k].title).join(", ")}</p>
      )}
      {m.note && <p className="small subtle">{m.note}</p>}
    </Field>
  );
}

/** benchmarks × parameters: ● shown on the page, ○ only in official data files or the paper, blank = not reported */
function ParamsGrid({ items, selected, onSelect, onOpen }: { items: TreeItem[]; selected: string; onSelect: (no: string) => void; onOpen: () => void }) {
  const cols = METRIC_KEYS;
  const count = (k: string) => items.filter((i) => i.metrics.params.some((p) => p.key === k)).length;
  return (
    <div className="bl-grid bl-matrix" role="grid" aria-label="Parameters each benchmark reports">
      <div className="bl-mrow bl-head" role="row">
        <span role="columnheader" className="c-no">No</span>
        <span role="columnheader">Benchmark</span>
        {cols.map((k) => (
          <span key={k} role="columnheader" className="m-cell" title={`${METRIC_INFO[k].help} — ${count(k)} of ${items.length}`}>
            {METRIC_INFO[k].title}<small>{count(k)}</small>
          </span>
        ))}
      </div>
      {items.map((i) => {
        const rk = new Map(reportedKeys(i.metrics).map((r) => [r.key, r]));
        return (
          <div key={i.no} role="row" data-no={i.no} className={`bl-mrow${selected === i.no ? " sel" : ""}`} onClick={() => onSelect(i.no)} onDoubleClick={onOpen}>
            <span className="c-no num">{i.no}</span>
            <span className="m-name" data-tip>
              <Link href={`/benchmarks/${encodeURIComponent(i.no)}`} className="bl-name-link"
                    onClick={(e) => e.stopPropagation()} title={`Open ${i.name}`}>{i.name}</Link>
            </span>
            {cols.map((k) => {
              const r = rk.get(k);
              const labels = i.metrics.params.filter((p) => p.key === k).map((p) => p.label).join("; ");
              return (
                <span key={k} role="gridcell" className={`m-cell${r ? ` on t-${k}` : ""}`}
                      title={r ? `${METRIC_INFO[k].title}: ${i.metrics.params.filter((p) => p.key === k).map((p) => p.label).join("; ")}` : i.metrics.params.length ? `${METRIC_INFO[k].title}: not reported` : "not researched"}>
                  {r ? (r.where === "page" ? "●" : "○") : i.metrics.params.length ? <span className="m-no">·</span> : "?"}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
