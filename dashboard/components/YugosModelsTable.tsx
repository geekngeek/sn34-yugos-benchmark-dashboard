"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { NoteCell } from "@/components/NoteCell";
import type { YugosModel } from "@/lib/yugosModels";
import { ColumnsMenu, DensityToggle, useColumnLayout, type ColDef, type SavedLayout } from "@/lib/columnLayout";
import { qFlag, qOne, useQuerySync, type Query } from "@/lib/urlState";
import { FilterButton, FilterChips, FilterPop, type Chip } from "@/components/FilterPop";
import { ArchiveButton, ArchivedTable, ArchiveSwitch, useArchive, type ArchiveMap } from "@/components/Archive";

type SortKey = "model" | "vendor" | "line" | "released" | "in" | "out" | "cheapest" | "providers" | "expires" | "results";
type View = "table" | "tree";
type GroupBy = "none" | "vendor" | "line";

/** one group of rows: plain rows in Table view, lineage families in Tree view */
interface Section { key: string; label: string; rows: YugosModel[]; entries: TreeEntry[]; names: string[]; lineage: string[] }

/** one tree entry: the newest shown model of a lineage, with its shown ancestors (newest → oldest) */
interface TreeEntry { top: YugosModel; nested: YugosModel[] }

/** how much cheaper a is than b, per side (null = not cheaper / unknown) */
function cheaperBy(a: YugosModel, b: YugosModel) {
  const pct = (x: number | null, y: number | null) => (x !== null && y !== null && y > 0 && x < y ? Math.round((1 - x / y) * 100) : null);
  return { in: pct(a.in_usd_m, b.in_usd_m), out: pct(a.out_usd_m, b.out_usd_m) };
}

const DAY = 86_400_000;
const NEW_DAYS = 30;        // "new" badge
const EXPIRY_WARN_DAYS = 21;

const daysSince = (d: string | null) => (d ? Math.floor((Date.now() - Date.parse(d)) / DAY) : null);
const daysUntil = (d: string | null) => (d ? Math.ceil((Date.parse(d) - Date.now()) / DAY) : null);

function age(d: string | null): string {
  const n = daysSince(d);
  if (n === null) return "";
  if (n < 1) return "today";
  if (n < 14) return `${n}d`;
  if (n < 70) return `${Math.round(n / 7)}w`;
  if (n < 730) return `${Math.round(n / 30.4)}mo`;
  return `${(n / 365).toFixed(1)}y`;
}

const usd = (v: number | null) =>
  v === null ? "—" : v === 0 ? "0" : v < 0.1 ? v.toFixed(3) : v < 10 ? v.toFixed(2).replace(/\.?0+$/, (m) => (m.startsWith(".") ? "" : m)) : v.toFixed(1).replace(/\.0$/, "");

const isNewest = (m: YugosModel) => m.track.startsWith("TRACK");
const trackNote = (m: YugosModel) => m.track.replace(/^(TRACK|drop):\s*/, "");

// columns in their default order and width (px); the user can drag and resize them (saved on the server)
const COLS: ColDef[] = [
  { key: "model", width: 460, min: 240 }, { key: "notes", width: 170, min: 60, hidden: true }, { key: "vendor", width: 140 },
  { key: "line", width: 160, hidden: true }, { key: "parent", width: 190, hidden: true }, { key: "results", width: 120, min: 70, fixed: true },
  { key: "released", width: 125, min: 80, fixed: true },
  { key: "in", width: 80, min: 50, fixed: true }, { key: "out", width: 85, min: 50, fixed: true }, { key: "cheapest", width: 115, min: 60, fixed: true },
  { key: "providers", width: 95, min: 80, fixed: true }, { key: "efforts", width: 150, hidden: true }, { key: "expires", width: 100, min: 70, fixed: true, hidden: true },
  { key: "reference", width: 115, min: 50, hidden: true },
];
const HEADS: Record<string, { label: string; sort?: SortKey; cls?: string }> = {
  model: { label: "Model", sort: "model" }, notes: { label: "Notes", cls: "ym-notes-h" }, vendor: { label: "Vendor", sort: "vendor" },
  line: { label: "Product line", sort: "line" }, parent: { label: "Parent" }, released: { label: "Released", sort: "released" },
  results: { label: "Results", sort: "results", cls: "num" },
  in: { label: "Input $/M", sort: "in", cls: "num" }, out: { label: "Output $/M", sort: "out", cls: "num" },
  cheapest: { label: "Cheapest out", sort: "cheapest", cls: "num" }, providers: { label: "Providers", sort: "providers", cls: "num" },
  efforts: { label: "Efforts" }, expires: { label: "Valid until", sort: "expires" }, reference: { label: "Reference" },
};

const SORTERS: Record<SortKey, (m: YugosModel) => string | number | null> = {
  model: (m) => m.model.toLowerCase(),
  vendor: (m) => m.vendor.toLowerCase(),
  line: (m) => m.line.toLowerCase(),
  released: (m) => m.released,
  in: (m) => m.in_usd_m,
  out: (m) => m.out_usd_m,
  cheapest: (m) => m.cheapest_out_usd_m,
  providers: (m) => m.offers.length,
  expires: (m) => m.valid_until,
  results: (m) => m.results ?? 0,
};

/** a product line oldest → newest, following parent → successor links (date order as fallback) */
function lineOf(models: YugosModel[], vendor: string, line: string): string[] {
  const members = models.filter((m) => m.vendor === vendor && m.line === line)
    .sort((a, b) => (a.released ?? "9").localeCompare(b.released ?? "9"));
  const byName = new Map(members.map((m) => [m.model, m]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const root of members.filter((m) => !m.parent || !byName.has(m.parent))) {
    for (let m: YugosModel | undefined = root; m && !seen.has(m.model); m = m.successor ? byName.get(m.successor) : undefined) {
      seen.add(m.model);
      out.push(m.model);
    }
  }
  return out.concat(members.filter((m) => !seen.has(m.model)).map((m) => m.model));
}

function compare(a: YugosModel, b: YugosModel, key: SortKey, dir: 1 | -1) {
  const x = SORTERS[key](a), y = SORTERS[key](b);
  if (x === y) return a.model.localeCompare(b.model);
  if (x === null) return 1;           // blanks last, whichever direction
  if (y === null) return -1;
  return (x < y ? -1 : 1) * dir;
}

export function YugosModelsTable({ models: allModels, initialNotes, initialExcluded, sourceNotes, layout, query: initialQuery, archived = {} }: {
  models: YugosModel[];
  archived?: ArchiveMap;
  layout?: SavedLayout;
  query?: Query;
  initialNotes: Record<string, string>;
  initialExcluded: string[];
  sourceNotes: string[];
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [excluded, setExcluded] = useState(() => new Set(initialExcluded));
  // archived models leave the page and its counts; archiving also takes a model out of the selection (the server does the same)
  const arc = useArchive("yugos-models", archived, (ids) => setExcluded((s) => new Set([...s, ...ids])));
  const [archView, setArchView] = useState(() => qFlag(initialQuery, "archived"));
  const models = useMemo(() => allModels.filter((m) => !arc.map[m.model]), [allModels, arc.map]);
  const [draft, setDraft] = useState<Set<string> | null>(null);   // non-null = edit (selection) mode
  const [history, setHistory] = useState<Set<string>[]>([]);       // undo steps inside edit mode
  // filters, view, grouping and sort start from the URL and are written back to it (see useQuerySync below)
  const [query, setQuery] = useState(() => qOne(initialQuery, "q"));
  const [vendor, setVendor] = useState(() => qOne(initialQuery, "vendor"));
  const [onlyNewest, setOnlyNewest] = useState(() => qFlag(initialQuery, "newest"));
  const [hideUtility, setHideUtility] = useState(() => qFlag(initialQuery, "noutil"));
  const [onlyNoted, setOnlyNoted] = useState(() => qFlag(initialQuery, "notes"));
  const [showExcluded, setShowExcluded] = useState(false);   // false = "Selected", true = "All"
  // ?show=all|selected wins; without it, the choice this browser made last time
  useEffect(() => {
    const fromUrl = qOne(initialQuery, "show");
    setShowExcluded(fromUrl ? fromUrl === "all" : localStorage.getItem("ym-show") === "all");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setShow = (all: boolean) => { setShowExcluded(all); localStorage.setItem("ym-show", all ? "all" : "selected"); };
  const [view, setView] = useState<View>(() => (qOne(initialQuery, "view") === "table" ? "table" : "tree"));
  const [groupBy, setGroupBy] = useState<GroupBy>(() => {
    const g = qOne(initialQuery, "group");
    return g === "none" || g === "line" ? g : "vendor";
  });
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>(() => {
    const k = qOne(initialQuery, "sort") as SortKey;
    const d = qOne(initialQuery, "dir");
    return k in SORTERS ? { key: k, dir: d === "asc" ? 1 : -1 } : { key: "released", dir: -1 };
  });
  const [openOffers, setOpenOffers] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const lastClicked = useRef<string | null>(null);

  const editing = draft !== null;
  useQuerySync({
    q: query.trim(), vendor, newest: onlyNewest, noutil: hideUtility, notes: onlyNoted,
    show: showExcluded ? "all" : null, archived: archView,
    view: view === "table" ? "table" : null, group: groupBy === "vendor" ? null : groupBy,
    sort: sort.key === "released" && sort.dir === -1 ? null : sort.key,
    dir: sort.key === "released" && sort.dir === -1 ? null : sort.dir === 1 ? "asc" : "desc",
  });
  const cl = useColumnLayout("yugos-models", COLS, layout, (editing ? 30 : 0) + 2);
  const out = draft ?? excluded;              // the exclusion set the page is showing
  const byName = useMemo(() => new Map(models.map((m) => [m.model, m])), [models]);
  const vendors = useMemo(() => [...new Set(models.map((m) => m.vendor))].sort((a, b) => a.localeCompare(b)), [models]);

  const q = query.trim().toLowerCase();
  const matches = (m: YugosModel) =>
    (!q || [m.model, m.vendor, m.line, m.parent ?? "", m.providers.join(" "), notes[m.model] ?? ""].join(" ").toLowerCase().includes(q)) &&
    (!vendor || m.vendor === vendor) &&
    (!onlyNewest || isNewest(m)) &&
    (!hideUtility || m.kind === "llm") &&
    (!onlyNoted || !!notes[m.model]);

  // rows the filters let through; outside edit mode, excluded models are hidden unless asked for
  const filtered = useMemo(
    () => models.filter((m) => matches(m) && (editing || showExcluded || !out.has(m.model))).sort((a, b) => compare(a, b, sort.key, sort.dir)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [models, q, vendor, onlyNewest, hideUtility, onlyNoted, showExcluded, editing, out, sort, notes],
  );

  // tree view: every lineage head (a model nothing else names as parent) with its ancestors
  const chains = useMemo(() => {
    const isParent = new Set(models.map((m) => m.parent).filter(Boolean) as string[]);
    return models.filter((m) => !isParent.has(m.model)).map((head) => {
      const chain = [head];
      for (let p = head.parent; p && byName.has(p) && !chain.some((c) => c.model === p); p = byName.get(p)!.parent) chain.push(byName.get(p)!);
      return chain;
    });
  }, [models, byName]);

  const tree = useMemo<TreeEntry[]>(() => {
    if (view !== "tree") return [];
    const shown = new Set(filtered.map((m) => m.model));
    const seen = new Set<string>();
    const entries: TreeEntry[] = [];
    for (const chain of chains) {
      const vis = chain.filter((m) => shown.has(m.model));   // hidden links are skipped, the chain carries on
      if (!vis.length || seen.has(vis[0].model)) continue;   // two heads can share an older parent
      seen.add(vis[0].model);
      entries.push({ top: vis[0], nested: vis.slice(1) });
    }
    return entries.sort((a, b) => compare(a.top, b.top, sort.key, sort.dir));
  }, [view, filtered, chains, sort]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const treeOpen = (name: string) => expanded.has(name) || !!q;   // searching opens every branch

  // groups for either view; in Tree view a family goes in the group of its newest model
  const sections = useMemo<Section[]>(() => {
    const keyOf = (m: YugosModel) => (groupBy === "vendor" ? m.vendor : groupBy === "line" ? `${m.vendor} · ${m.line || "no product line"}` : "");
    const map = new Map<string, Section>();
    const section = (m: YugosModel) => {
      const key = keyOf(m);
      if (!map.has(key)) {
        map.set(key, { key, label: key, rows: [], entries: [], names: [],
          // the whole product line oldest → newest, from the catalog (not just the rows on screen)
          lineage: groupBy === "line" && m.line ? lineOf(models, m.vendor, m.line) : [] });
      }
      return map.get(key)!;
    };
    if (view === "tree") {
      for (const e of tree) { const sec = section(e.top); sec.entries.push(e); sec.names.push(e.top.model, ...e.nested.map((m) => m.model)); }
    } else {
      for (const m of filtered) { const sec = section(m); sec.rows.push(m); sec.names.push(m.model); }
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [view, groupBy, tree, filtered, models]);

  // rows in the order they appear on screen (shift-click ranges follow this)
  const flat = useMemo(
    () => sections.flatMap((sec) => (view === "tree"
      ? sec.entries.flatMap((e) => (treeOpen(e.top.model) ? [e.top, ...e.nested] : [e.top]))
      : sec.rows)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, sections, expanded, q],
  );
  const watched = models.filter((m) => !out.has(m.model)).length;

  // --- edit (selection) mode -------------------------------------------------------------
  const change = (next: Set<string>) => { setHistory((h) => [...h.slice(-49), draft!]); setDraft(next); };
  const setMany = (names: string[], keep: boolean) => {
    const next = new Set(draft!);
    names.forEach((n) => (keep ? next.delete(n) : next.add(n)));
    change(next);
  };
  const toggleRow = (name: string, e: MouseEvent | KeyboardEvent) => {
    const keep = draft!.has(name);
    if (e.shiftKey && lastClicked.current) {          // shift-click: apply to the whole range
      const i = flat.findIndex((m) => m.model === lastClicked.current), j = flat.findIndex((m) => m.model === name);
      if (i >= 0 && j >= 0) {
        setMany(flat.slice(Math.min(i, j), Math.max(i, j) + 1).map((m) => m.model), keep);
        lastClicked.current = name;
        return;
      }
    }
    setMany([name], keep);
    lastClicked.current = name;
  };
  const startEdit = () => { setDraft(new Set(excluded)); setHistory([]); setStatus(""); };
  const cancelEdit = () => { setDraft(null); setHistory([]); };
  const undo = () => { if (history.length) { setDraft(history[history.length - 1]); setHistory((h) => h.slice(0, -1)); } };
  const saveEdit = async () => {
    const next = new Set([...draft!, ...Object.keys(arc.map)]);   // archived models always stay out of the selection
    setStatus("Saving…");
    const res = await fetch("/api/yugos-models", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ excluded: [...next] }),
    });
    if (!res.ok) { setStatus(`Not saved: ${(await res.json().catch(() => ({}))).error ?? res.statusText}`); return; }
    setExcluded(new Set(next));
    setDraft(null);
    setHistory([]);
    setStatus(`Saved · watching ${models.filter((m) => !next.has(m.model)).length} of ${models.length}`);
  };

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo(); }
      if (e.key === "Escape" && !(e.target instanceof HTMLTextAreaElement)) cancelEdit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // --- jump to a parent / successor row --------------------------------------------------
  const jumpTo = (name: string) => {
    const m = byName.get(name);
    if (!m) return;
    if (!matches(m)) { setQuery(""); setVendor(""); setOnlyNewest(false); setHideUtility(false); setOnlyNoted(false); }
    if (!editing && out.has(name)) setShowExcluded(true);
    setFlash(name);
  };
  useEffect(() => {
    if (!flash) return;
    document.getElementById(`ym-${flash}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash, flat]);

  // --- notes -----------------------------------------------------------------------------
  const saveNote = async (model: string, note: string) => {
    const prev = notes[model] ?? "";
    if (note.trim() === prev) return;
    setNotes((n) => { const c = { ...n }; if (note.trim()) c[model] = note.trim(); else delete c[model]; return c; });
    const res = await fetch("/api/yugos-models", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, note }),
    });
    if (!res.ok) {
      setNotes((n) => ({ ...n, [model]: prev }));
      setStatus(`Note not saved: ${(await res.json().catch(() => ({}))).error ?? res.statusText}`);
    } else setStatus(`Note saved · ${model}`);
  };

  // --- CSV of what is on screen -----------------------------------------------------------
  const download = () => {
    const cols = ["model", "vendor", "line", "parent", "successor", "released", "in_usd_m", "out_usd_m", "cheapest_out_usd_m",
      "cheapest_provider", "providers", "efforts", "valid_until", "newest_in_line", "reference_url", "selected", "note"];
    const cell = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = view === "tree" ? sections.flatMap((sec) => sec.entries.flatMap((e) => [e.top, ...e.nested])) : flat;
    const lines = rows.map((m) => [m.model, m.vendor, m.line, m.parent, m.successor, m.released, m.in_usd_m, m.out_usd_m, m.cheapest_out_usd_m,
      m.cheapest_provider, m.providers.join(" "), m.efforts.join(" "), m.valid_until, isNewest(m) ? "yes" : "no", m.reference_url,
      out.has(m.model) ? "no" : "yes", notes[m.model] ?? ""].map(cell).join(","));
    const blob = new Blob([[cols.join(","), ...lines].join("\n") + "\n"], { type: "text/csv" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "yugos-models.csv" });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // filters live in the column headers (▾): Model = newest / utility, Vendor = one vendor, Notes = with notes
  const [pop, setPop] = useState<string | null>(null);
  const filterOn: Record<string, boolean> = { model: onlyNewest || hideUtility || onlyNoted, vendor: !!vendor };
  const popups: Record<string, () => React.ReactNode> = {
    model: () => (<>
      <p className="hf-title">Model</p>
      <label className="hf-opt"><input type="checkbox" checked={onlyNewest} onChange={(e) => setOnlyNewest(e.target.checked)} /> Newest in each line</label>
      <label className="hf-opt"><input type="checkbox" checked={hideUtility} onChange={(e) => setHideUtility(e.target.checked)} /> Hide utility / vision</label>
      <label className="hf-opt hf-sep"><input type="checkbox" checked={onlyNoted} onChange={(e) => setOnlyNoted(e.target.checked)} /> Only models with notes</label>
    </>),
    vendor: () => (<>
      <p className="hf-title">Vendor</p>
      <label className="hf-opt"><input type="radio" name="ym-vendor" checked={!vendor} onChange={() => setVendor("")} /> All vendors<span className="hf-n">{models.length}</span></label>
      {vendors.map((v) => (
        <label key={v} className="hf-opt"><input type="radio" name="ym-vendor" checked={vendor === v} onChange={() => setVendor(v)} /> {v}
          <span className="hf-n">{models.filter((m) => m.vendor === v).length}</span></label>))}
    </>),
  };
  const th = (key: string) => {
    const h = HEADS[key];
    const hp = cl.head(key);
    const sorted = !!h.sort && sort.key === h.sort;
    return (
      <th key={key} {...hp} className={`${hp.className}${h.cls ? ` ${h.cls}` : ""}${sorted || filterOn[key] ? " col-on" : ""}`}
        aria-sort={sorted ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
        <span className="th-in">
          {h.sort ? (
            <button type="button" className="ym-sort col-sort" onClick={() => setSort((s) => ({ key: h.sort!, dir: s.key === h.sort ? (-s.dir as 1 | -1) : h.sort === "released" ? -1 : 1 }))}>
              {h.label}{sorted && <span className="col-arrow">{sort.dir === 1 ? "▲" : "▼"}</span>}
            </button>
          ) : <span>{h.label}</span>}
          {popups[key] && <FilterButton col={key} label={h.label} on={!!filterOn[key]} open={pop === key} onToggle={() => setPop((p) => (p === key ? null : key))} />}
        </span>
        {cl.grip(key)}
      </th>
    );
  };
  const chips: Chip[] = [];
  if (q) chips.push({ key: "q", label: `Search: “${query.trim()}”`, clear: () => setQuery("") });
  if (vendor) chips.push({ key: "vendor", label: `Vendor: ${vendor}`, clear: () => setVendor(""), open: () => setPop("vendor") });
  if (onlyNewest) chips.push({ key: "newest", label: "Newest in each line", clear: () => setOnlyNewest(false), open: () => setPop("model") });
  if (hideUtility) chips.push({ key: "util", label: "Utility / vision hidden", clear: () => setHideUtility(false), open: () => setPop("model") });
  if (onlyNoted) chips.push({ key: "notes", label: "With notes", clear: () => setOnlyNoted(false), open: () => setPop("model") });
  const clearAll = () => { setQuery(""); setVendor(""); setOnlyNewest(false); setHideUtility(false); setOnlyNoted(false); };


  // every row the filters let through, including ones inside closed tree branches
  const visibleNames = filtered.map((m) => m.model);
  const allVisibleKept = editing && visibleNames.length > 0 && visibleNames.every((n) => !draft!.has(n));
  const someVisibleKept = editing && visibleNames.some((n) => !draft!.has(n));
  const filtersOn = !!(q || vendor || onlyNewest || hideUtility || onlyNoted);
  const colCount = cl.cols.length + (editing ? 1 : 0);

  /** one model row (+ its provider listings when opened); depth > 0 = nested parent in the tree view */
  const ids = new Set<string>();   // a shared parent can show twice in the tree; only the first gets the anchor id
  // band: 0/1 alternating background. In the tree a whole family (newest + its parents) shares one band;
  // fam: the row belongs to an opened family ("head" = its newest row, "end" = its last parent)
  const renderRow = (m: YugosModel, t: { band: number; depth?: number; key?: string; caret?: React.ReactNode; tags?: React.ReactNode; tree?: boolean; fam?: "head" | "mid" | "end" }) => {
    const left = out.has(m.model);
    const fresh = (daysSince(m.released) ?? 999) <= NEW_DAYS;
    const until = daysUntil(m.valid_until);
    const cheaper = m.cheapest_out_usd_m !== null && m.out_usd_m !== null && m.cheapest_out_usd_m < m.out_usd_m * 0.95;
    const cells: Record<string, () => React.ReactNode> = {
      model: () => (
              <td key="model" className="ym-model" title={[m.model_id && `Model ID: ${m.model_id}`, trackNote(m)].filter(Boolean).join("\n")} style={t.depth ? { paddingLeft: 10 + t.depth * 18 } : undefined}>
                {/* the name shortens with "…" when the column is narrow; the tags always stay visible */}
                <span className="ym-model-in">
                  {t.tree && (t.caret ?? <span className="ym-caret-space" aria-hidden="true">{t.depth ? "└" : ""}</span>)}
                  <span className={`ym-name${left ? "" : " sel"}`}>{m.model}</span>
                  <span className="ym-tags">
                    {t.tags}
                    {isNewest(m) && <span className="ym-tag newest" title="Newest model in its product line">newest</span>}
                    {fresh && <span className="ym-tag new" title={`Released in the last ${NEW_DAYS} days`}>new</span>}
                    {m.kind !== "llm" && <span className="ym-tag util" title="Utility / vision model">{m.kind.split("/")[0]}</span>}
                  </span>
                  {!editing && <ArchiveButton label={m.model} onClick={() => arc.ask([{ id: m.model, label: m.model }],
                    left ? undefined : "It is selected now: archiving also takes it out of the selection (a restored model comes back unselected).")} />}
                </span>
              </td>
      ),
      notes: () => (
              <td key="notes" className="ym-notes"><NoteCell value={notes[m.model] ?? ""} onSave={(v) => saveNote(m.model, v)} label={m.model} /></td>
      ),
      vendor: () => (
              <td key="vendor" className="clip" title={m.vendor}>{m.vendor}</td>
      ),
      line: () => (
              <td key="line" className="clip" title={m.line}>{m.line}</td>
      ),
      parent: () => (
              <td key="parent" className="ym-parent">
                {m.parent ? <button type="button" className="link" onClick={() => jumpTo(m.parent!)} title={`Go to ${m.parent}`}>↑ {m.parent}</button> : <span className="subtle">—</span>}
                {m.successor && <button type="button" className="link ym-succ" onClick={() => jumpTo(m.successor!.split(" ")[0])} title={`Newer in this line: ${m.successor.split(" ").join(", ")}`}>↓</button>}
              </td>
      ),
      results: () => {
        const how = m.model_link === "none" || !m.model_link ? "" : ` (name matched: ${m.model_link})`;
        if (m.results && m.model_uuid) {
          return (
            <td key="results" className="num" title={`${m.model_id}: ${m.results} results in ${m.benchmarks} benchmarks${how}`}>
              {m.results.toLocaleString("en-US")}
              <span className="subtle"> · {m.benchmarks}b</span>
            </td>
          );
        }
        return (
          <td key="results" className="num subtle"
              title={m.model_id ? `${m.model_id}: no benchmark results yet${how}` : "Not found in any benchmark source"}>—</td>
        );
      },
      released: () => (
              <td key="released" className="ym-date" title={m.released ? "OpenRouter listing date (close to vendor launch)" : "No release date found (not listed on OpenRouter)"}>
                {m.released ?? <span className="subtle">—</span>} <span className="subtle">{age(m.released)}</span>
              </td>
      ),
      in: () => (
              <td key="in" className="num">{usd(m.in_usd_m)}</td>
      ),
      out: () => (
              <td key="out" className="num" title={`price from ${m.price_source}`}>{usd(m.out_usd_m)}</td>
      ),
      cheapest: () => (
              <td key="cheapest" className={`num${cheaper ? " ym-cheaper" : ""}`} title={cheaper ? `cheaper on ${m.cheapest_provider}` : m.cheapest_provider}>
                {usd(m.cheapest_out_usd_m)} <span className="subtle">{m.cheapest_provider}</span>
              </td>
      ),
      providers: () => (
              <td key="providers" className="num">
                <button type="button" className="link" aria-expanded={openOffers === m.model}
                  onClick={() => setOpenOffers((o) => (o === m.model ? null : m.model))} title={m.providers.join(", ")}>
                  {m.offers.length} {openOffers === m.model ? "▾" : "▸"}
                </button>
              </td>
      ),
      efforts: () => (
              <td key="efforts" className="clip ym-efforts" title={m.efforts.join(", ") || "no effort levels"}>{m.efforts.join(" · ") || <span className="subtle">—</span>}</td>
      ),
      expires: () => (
              <td key="expires" className={until !== null && until <= EXPIRY_WARN_DAYS ? "ym-expiring" : ""}
                title={until !== null && until <= EXPIRY_WARN_DAYS ? `Leaves the card in ${until} days` : "Card listing valid until"}>
                {m.valid_until ?? "—"}
              </td>
      ),
      reference: () => (
              <td key="reference">{m.reference_url ? <a href={m.reference_url} target="_blank" rel="noreferrer" title={m.reference_url}>{m.reference_label} ↗</a> : "—"}</td>
      ),
    };
    return (
      <Fragment key={t.key ?? m.model}>
        <tr id={ids.has(m.model) ? undefined : (ids.add(m.model), `ym-${m.model}`)}
          className={`ym-band-${t.band}${left ? " ym-out" : ""}${flash === m.model ? " ym-flash" : ""}${editing ? " ym-pick" : ""}${t.depth ? " ym-nested" : ""}${t.tree && !t.depth ? " ym-top" : ""}${t.fam ? ` ym-fam ym-fam-${t.fam}` : ""}`}
          onClick={editing ? (e) => { if (!(e.target as HTMLElement).closest("a,button,textarea,input")) toggleRow(m.model, e); } : undefined}>
          {editing && (
            <td className="ym-check">
              <input type="checkbox" checked={!left} aria-label={`Watch ${m.model}`}
                onClick={(e) => { e.stopPropagation(); toggleRow(m.model, e); }} onChange={() => {}} />
            </td>
          )}
          {cl.cols.map((c) => cells[c.key]())}
        </tr>
        {openOffers === m.model && (
          <tr className={`ym-offers ym-band-${t.band}${t.fam ? " ym-fam ym-fam-mid" : ""}`}>
            <td colSpan={colCount}>
              <table className="ym-offer-table">
                <thead><tr><th>Provider</th><th>Card id</th><th className="num">Input $/M</th><th className="num">Output $/M</th><th className="num">Cached $/M</th><th>Efforts</th><th>Valid until</th></tr></thead>
                <tbody>
                  {m.offers.map((o) => (
                    <tr key={o.provider + o.id}>
                      <td>{o.provider}</td><td className="mono">{o.id}</td>
                      <td className="num">{usd(o.in)}</td><td className="num">{usd(o.out)}</td><td className="num">{usd(o.cached)}</td>
                      <td>{o.efforts.join(" · ") || <span className="subtle">none</span>}</td><td>{o.valid_until ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <div className={`ym${editing ? " editing" : ""}`}>
      <div className="ym-bar">
        <div className="ym-count">
          {!editing && <ArchiveSwitch on={archView} count={arc.count} onChange={setArchView} noun="models" />}
          {!archView && <><strong>{watched}</strong> of {models.length} models selected</>}
          {!editing && !archView && (
            <span className="seg" role="group" aria-label="Which models to show">
              <button type="button" className={!showExcluded ? "on" : ""} aria-pressed={!showExcluded} onClick={() => setShow(false)}>Selected</button>
              <button type="button" className={showExcluded ? "on" : ""} aria-pressed={showExcluded} onClick={() => setShow(true)}>All</button>
            </span>
          )}
        </div>
        {!archView && <div className="ym-actions">
          {status && <span className="ym-status" role="status">{status}</span>}
          {!editing && <button type="button" className="button" onClick={download} title="Download the rows on screen as CSV">Download CSV</button>}
          {!editing
            ? <button type="button" className="button primary" onClick={startEdit}>Edit selection</button>
            : <>
                <button type="button" className="button" onClick={undo} disabled={!history.length} title="Undo (Ctrl+Z)">Undo</button>
                <button type="button" className="button" onClick={cancelEdit} title="Discard changes (Esc)">Cancel</button>
                <button type="button" className="button primary" onClick={saveEdit}>Save · {models.filter((m) => !draft!.has(m.model)).length} selected</button>
              </>}
        </div>}
      </div>
      {arc.toast}{arc.dialog}
      {archView ? (
        <ArchivedTable map={arc.map} noun="models" detailLabel="Vendor · line" onRestore={(ids) => arc.restore(ids)}
          rows={allModels.map((m) => ({ id: m.model, label: m.model, search: `${m.vendor} ${m.line}`,
            detail: <>{m.vendor} · {m.line}{m.released ? <span className="muted"> · released {m.released}</span> : null}</> }))} />
      ) : <>

      {editing && (
        <div className="ym-editbar" role="toolbar" aria-label="Selection tools">
          <span className="ym-edit-hint">Selection mode: untick models to leave them out. Shift-click ticks or unticks a range.</span>
          <span className="ym-edit-tools">
            <button type="button" className="link" onClick={() => change(new Set())}>Select all</button>
            <button type="button" className="link" onClick={() => change(new Set(models.map((m) => m.model)))}>Select none</button>
            <button type="button" className="link" onClick={() => change(new Set(models.filter((m) => !isNewest(m)).map((m) => m.model)))}
              title="Keep only the newest model of each product line">Only newest in each line</button>
            <button type="button" className="link" onClick={() => setMany(visibleNames, true)}
              disabled={!filtersOn} title="Tick every row the current filters show">Tick shown rows</button>
            <button type="button" className="link" onClick={() => setMany(visibleNames, false)} disabled={!filtersOn}
              title="Untick every row the current filters show">Untick shown rows</button>
            <button type="button" className="link" onClick={() => change(new Set(models.map((m) => m.model).filter((n) => !visibleNames.includes(n))))}
              disabled={!filtersOn} title="Keep exactly what the filters show and leave everything else out">Keep only shown rows</button>
          </span>
        </div>
      )}

      <div className="ym-filters">
        <input type="search" className="ym-search" placeholder="Search model, vendor, line, provider, note…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search models" />
        <span className="seg" role="group" aria-label="View">
          {(["table", "tree"] as View[]).map((v) => (
            <button key={v} type="button" className={view === v ? "on" : ""} aria-pressed={view === v} onClick={() => setView(v)}>{v === "table" ? "Table" : "Tree"}</button>
          ))}
        </span>
        <span className="ym-group"><span className="ctl-lab">Group</span>
          <span className="seg" role="group" aria-label="Group by">
            {(["none", "vendor", "line"] as GroupBy[]).map((g) => (
              <button key={g} type="button" className={groupBy === g ? "on" : ""} aria-pressed={groupBy === g} onClick={() => setGroupBy(g)}>
                {g === "none" ? "None" : g === "vendor" ? "Vendor" : "Product line"}
              </button>
            ))}
          </span>
        </span>
        <span className="bl-total"><b>{visibleNames.length}</b> {view === "tree" ? `models · ${tree.length} newest` : "shown"}</span>
        <span className="bl-viewopts">
          {view === "tree" && <>
            <button type="button" className="link" onClick={() => setExpanded(new Set(tree.filter((e) => e.nested.length).map((e) => e.top.model)))}>Expand all</button>
            <button type="button" className="link" onClick={() => setExpanded(new Set())} disabled={!expanded.size}>Collapse all</button>
          </>}
          <ColumnsMenu layout={cl} labels={Object.fromEntries(Object.entries(HEADS).map(([k, h]) => [k, h.label]))} />
          <DensityToggle />
        </span>
      </div>
      <FilterChips chips={chips} onClearAll={clearAll} />
      {pop && popups[pop] && <FilterPop anchor={pop} onClose={() => setPop(null)}>{popups[pop]()}</FilterPop>}

      <div className="ym-scroll" ref={cl.root}>
        <table className="grid ym-table cl" style={{ width: cl.total + (editing ? 30 : 0) }}>
          <colgroup>
            {editing && <col style={{ width: 30 }} />}
            {cl.cols.map((c) => <col key={c.key} style={{ width: cl.width(c.key) }} />)}
          </colgroup>
          <thead>
            <tr>
              {editing && (
                <th className="ym-check">
                  <input type="checkbox" aria-label="Tick or untick all shown rows" checked={allVisibleKept}
                    ref={(el) => { if (el) el.indeterminate = someVisibleKept && !allVisibleKept; }}
                    onChange={() => setMany(visibleNames, !allVisibleKept)} />
                </th>
              )}
              {cl.cols.map((c) => th(c.key))}
            </tr>
          </thead>
          <tbody>
            {flat.length === 0 && (
              <tr><td colSpan={colCount} className="ym-empty">No models match. {out.size > 0 && !editing && !showExcluded ? "Some models aren’t selected; click “Show all” to see them." : ""}</td></tr>
            )}
            {sections.map((sec, si) => {
              const gKept = editing ? sec.names.filter((n) => !draft!.has(n)).length : 0;
              const count = view === "tree" ? `${sec.entries.length} newest · ${sec.names.length} models` : String(sec.rows.length);
              return (
                <Fragment key={sec.key || "all"}>
                  {sec.label && si > 0 && (
                    <tr className="ym-gap" aria-hidden="true"><td colSpan={colCount} /></tr>
                  )}
                  {sec.label && (
                    <tr className="ym-grouprow">
                      {editing && (
                        <td className="ym-check">
                          <input type="checkbox" aria-label={`Tick or untick all of ${sec.label}`} checked={gKept === sec.names.length}
                            ref={(el) => { if (el) el.indeterminate = gKept > 0 && gKept < sec.names.length; }}
                            onChange={() => setMany(sec.names, gKept !== sec.names.length)} />
                        </td>
                      )}
                      <td colSpan={colCount - (editing ? 1 : 0)}>
                        <strong>{sec.label}</strong> <span className="subtle">· {count}</span>
                        {sec.lineage.length > 1 && <span className="ym-lineage">{sec.lineage.join(" → ")}</span>}
                      </td>
                    </tr>
                  )}
                  {view === "table" && sec.rows.map((m, i) => renderRow(m, { band: i % 2 }))}
                  {view === "tree" && sec.entries.map(({ top, nested }, fi) => {
                  const open = treeOpen(top.model);
                  // a parent is "cheaper" when its input or output price is below the newest model it sits under
                  const cheaperKids = nested.map((a) => ({ a, c: cheaperBy(a, top) })).filter((x) => x.c.in !== null || x.c.out !== null);
                  const caret = nested.length
                    ? <button type="button" className="ym-caret" aria-expanded={open} title={open ? "Hide parents" : "Show parents"}
                        onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(top.model)) n.delete(top.model); else n.add(top.model); return n; })}>
                        {open ? "▾" : "▸"}<span className="ym-caret-n">{nested.length}</span>
                      </button>
                    : undefined;
                  const topTags = cheaperKids.length > 0 && (
                    <span className="ym-tag cheaper-parent" title={`Cheaper child${cheaperKids.length > 1 ? "ren" : ""}: ${cheaperKids.map((x) => x.a.model).join(", ")}`}>
                      {cheaperKids.length} cheaper
                    </span>
                  );
                  return (
                    <Fragment key={`t:${top.model}`}>
                      {renderRow(top, { band: fi % 2, depth: 0, key: `t:${top.model}`, caret, tags: topTags, tree: true, fam: open && nested.length ? "head" : undefined })}
                      {open && nested.map((a, i) => {
                        const c = cheaperBy(a, top);
                        const tags = <>
                          {(c.in !== null || c.out !== null) && (
                            <span className="ym-tag cheaper" title={`Cheaper than ${top.model}: ${[c.in !== null && `input −${c.in}%`, c.out !== null && `output −${c.out}%`].filter(Boolean).join(", ")}`}>
                              {c.in !== null && c.out !== null ? `−${c.in}% / −${c.out}%` : c.in !== null ? `in −${c.in}%` : `out −${c.out}%`}
                            </span>
                          )}
                        </>;
                        return renderRow(a, { band: fi % 2, depth: i + 1, key: `t:${top.model}:${a.model}`, tags, tree: true, fam: i === nested.length - 1 ? "end" : "mid" });
                      })}
                    </Fragment>
                  );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      </>}
      <ul className="ym-foot subtle small">
        {sourceNotes.map((n) => <li key={n}>{n}</li>)}
        <li>Selected models have dark names; models left out are grey. “newest” marks the newest model in its product line. In Tree view each newest model opens to its parents; a green “−76% / −67%” tag shows how much less a parent costs per input / output token than the newest model, and “3 cheaper” marks a newest model with that many cheaper older models nested under it. ↑ goes to the parent model, ↓ to its successor. The Providers count opens every listing with its own price.</li>
        <li>Results: benchmark results for the model (and how many benchmarks), linked to the Results page. Each Yugos
          name is matched to the project model ID by data/models (hover a model or its count to see the ID and how it matched).</li>
        <li>Notes, the selection and archived models are saved on the server and shared by everyone who opens this dashboard. Archiving a model (its box button) takes it off this page and out of the selection; restore it under Archived.</li>
      </ul>
    </div>
  );
}

