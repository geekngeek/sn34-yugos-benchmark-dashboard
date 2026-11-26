"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { ModelConfig } from "@/lib/api";

/**
 * Model selection in the manner of Artificial Analysis: a "N of M models" button opens a panel with search,
 * filters, the selected models first, then every model with its effort variants, and Clear / Select all /
 * Reset (to default) / Save / Load. The selection is kept in the URL (?models=…) and applies to every table
 * on the page. Without ?models the default applies: the models selected on the Yugos models page.
 */

const EFFORT_ORDER = ["max", "xhigh", "high", "medium", "low", "minimal", "enabled", "none", ""];
const effortLabel = (c: ModelConfig) => {
  const e = c.reasoning_effort;
  const base = e === null ? "Default" : e === "none" ? "Non-reasoning" : e === "enabled" ? "Reasoning" : e === "xhigh" ? "Xhigh" : e[0].toUpperCase() + e.slice(1);
  return c.mode ? `${base} · ${c.mode}` : base;
};
const fullLabel = (c: ModelConfig) => (c.reasoning_effort === null && !c.mode ? c.model_name : `${c.model_name} (${effortLabel(c)})`);

export interface PickerProps {
  configs: ModelConfig[];          // every configuration that has results in this page's tables
  selected: string[];              // the current selection (from the URL, or the default)
  defaults: string[];              // what "Reset (to default)" gives
  defaultNote: string;             // how the default was chosen, shown in the panel
  yugos: string[];                 // model IDs selected on the Yugos models page (for the "In Yugos" filter)
}

export function ModelPicker({ configs, selected, defaults, defaultNote, yugos }: PickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(() => new Set(selected));
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [dev, setDev] = useState("");
  const [effort, setEffort] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [inYugos, setInYugos] = useState("");
  const [saveName, setSaveName] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ name: string; configs: string[] }[] | null>(null);
  const [msg, setMsg] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const yugosSet = useMemo(() => new Set(yugos), [yugos]);
  const all = useMemo(() => configs.map((c) => c.config), [configs]);

  useEffect(() => { setSel(new Set(selected)); }, [selected]);   // the URL changed (back/forward, load)

  // close on an outside click or Escape
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);

  /** write the selection to the URL (?models=…); the page reloads its tables from it */
  const apply = (next: Set<string>) => {
    setSel(next);
    const qs = new URLSearchParams(params.toString());
    qs.delete("page");
    const list = all.filter((c) => next.has(c));
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
    if (same(list, defaults.filter((c) => all.includes(c)))) qs.delete("models");
    else if (list.length === all.length) qs.set("models", "all");
    else if (!list.length) qs.set("models", "none");
    else qs.set("models", list.join(","));
    startTransition(() => router.replace(`${pathname}${qs.size ? `?${qs}` : ""}`, { scroll: false }));
  };
  const toggle = (configsToFlip: string[], on: boolean) => {
    const next = new Set(sel);
    configsToFlip.forEach((c) => (on ? next.add(c) : next.delete(c)));
    apply(next);
  };

  // search + filters decide which configurations the list shows
  const q = query.trim().toLowerCase();
  const developers = useMemo(() => [...new Set(configs.map((c) => c.provider))].sort((a, b) => a.localeCompare(b)), [configs]);
  const visible = configs.filter((c) =>
    (!q || `${c.model_name} ${c.model_key} ${c.provider} ${effortLabel(c)}`.toLowerCase().includes(q)) &&
    (!dev || c.provider === dev) &&
    (!effort || (effort === "default" ? c.reasoning_effort === null : c.reasoning_effort === effort)) &&
    (!reasoning || (reasoning === "yes" ? c.reasoning_effort !== null && c.reasoning_effort !== "none" : c.reasoning_effort === "none")) &&
    (!inYugos || (inYugos === "yes") === yugosSet.has(c.model_key)));
  const filtered = !!(q || dev || effort || reasoning || inYugos);

  // every model with its variants, best model first
  const groups = useMemo(() => {
    const m = new Map<string, ModelConfig[]>();
    for (const c of visible) m.set(c.model_key, [...(m.get(c.model_key) ?? []), c]);
    return [...m.values()].map((v) => v.sort((a, b) =>
      (b.effort_rank ?? -1) - (a.effort_rank ?? -1) || EFFORT_ORDER.indexOf(a.reasoning_effort ?? "") - EFFORT_ORDER.indexOf(b.reasoning_effort ?? "")));
  }, [visible]);
  const chosen = configs.filter((c) => sel.has(c.config));

  const loadSaved = async () => {
    const r = await fetch("/api/model-selections").then((x) => x.json()).catch(() => ({ selections: [] }));
    setSaved(r.selections ?? []);
  };
  const save = async () => {
    const name = (saveName ?? "").trim();
    if (!name) return;
    const r = await fetch("/api/model-selections", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, configs: [...sel] }) });
    setMsg(r.ok ? `Saved “${name}”` : "Could not save");
    setSaveName(null);
    if (saved) loadSaved();
  };
  const remove = async (name: string) => {
    const r = await fetch("/api/model-selections", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, delete: true }) }).then((x) => x.json());
    setSaved(r.selections ?? []);
  };

  return (
    <div className="mp" ref={root}>
      <button type="button" className={`mp-trigger${pending ? " busy" : ""}`} aria-haspopup="dialog" aria-expanded={open}
              onClick={() => setOpen((o) => !o)}>
        <span>{chosen.length} of {configs.length} models</span><span className="mp-caret" aria-hidden="true">⇕</span>
      </button>
      {open && (
        <div className="mp-panel" role="dialog" aria-label="Choose models">
          <div className="mp-top">
            <input type="search" className="mp-search" placeholder="Search…" value={query} autoFocus
                   onChange={(e) => setQuery(e.target.value)} aria-label="Search models" />
            <button type="button" className={`mp-icon${showFilters || filtered ? " on" : ""}`} title="Filters"
                    aria-pressed={showFilters} onClick={() => setShowFilters((f) => !f)}>⏷</button>
          </div>
          {showFilters && (
            <div className="mp-filters">
              <label>Developer
                <select value={dev} onChange={(e) => setDev(e.target.value)}>
                  <option value="">Any</option>{developers.map((d) => <option key={d}>{d}</option>)}
                </select>
              </label>
              <label>Effort level
                <select value={effort} onChange={(e) => setEffort(e.target.value)}>
                  <option value="">Any</option>
                  {["max", "xhigh", "high", "medium", "low", "minimal", "enabled", "none"].map((e) => <option key={e} value={e}>{e === "enabled" ? "reasoning (no level)" : e === "none" ? "non-reasoning" : e}</option>)}
                  <option value="default">not stated</option>
                </select>
              </label>
              <label>Reasoning
                <select value={reasoning} onChange={(e) => setReasoning(e.target.value)}>
                  <option value="">Any</option><option value="yes">Reasoning</option><option value="no">Non-reasoning</option>
                </select>
              </label>
              <label>In Yugos
                <select value={inYugos} onChange={(e) => setInYugos(e.target.value)}>
                  <option value="">Any</option><option value="yes">Selected on Yugos models</option><option value="no">Not selected there</option>
                </select>
              </label>
            </div>
          )}

          <div className="mp-list">
            {!filtered && chosen.length > 0 && (
              <>
                <div className="mp-section">Selected · {chosen.length}</div>
                {chosen.map((c) => (
                  <button key={`s-${c.config}`} type="button" className="mp-item" onClick={() => toggle([c.config], false)} title={`${c.config} · click to remove`}>
                    <span className="mp-name">{c.model_name}</span>{(c.reasoning_effort !== null || c.mode) && <span className="mp-variant"> ({effortLabel(c)})</span>}
                    <span className="mp-dot" aria-hidden="true" />
                  </button>
                ))}
              </>
            )}
            <div className="mp-section">{filtered ? `Matching · ${visible.length}` : `All models · ${configs.length}`}</div>
            {groups.map((g) => {
              const n = g.filter((c) => sel.has(c.config)).length;
              const head = g[0];
              return (
                <div key={head.model_key} className="mp-group">
                  <label className="mp-model" title={head.model_key}>
                    <input type="checkbox" checked={n === g.length} ref={(el) => { if (el) el.indeterminate = n > 0 && n < g.length; }}
                           onChange={() => toggle(g.map((c) => c.config), n < g.length)} />
                    <span className="mp-name">{head.model_name}</span>
                    <span className="mp-dev">{head.provider}</span>
                    {yugosSet.has(head.model_key) && <span className="mp-yugos" title="Selected on the Yugos models page">Yugos</span>}
                  </label>
                  {(g.length > 1 || head.reasoning_effort !== null || head.mode) && g.map((c) => (
                    <label key={c.config} className="mp-variant-row" title={c.config}>
                      <input type="checkbox" checked={sel.has(c.config)} onChange={() => toggle([c.config], !sel.has(c.config))} />
                      <span>{effortLabel(c)}</span>
                      {c.yugos_providers.length > 0 && (
                        <span className="mp-yugos" title={`Yugos can route this: ${c.yugos_providers.join(", ")}`}>Yugos {c.yugos_providers.length}</span>
                      )}
                      <span className="mp-meta">{c.best_score !== null ? c.best_score.toFixed(1) : "—"} · {c.results}</span>
                    </label>
                  ))}
                </div>
              );
            })}
            {!groups.length && <p className="mp-empty">No models match.</p>}
          </div>

          <div className="mp-foot">
            <button type="button" onClick={() => apply(filtered ? new Set([...sel].filter((c) => !visible.some((v) => v.config === c))) : new Set())}>
              {filtered ? "Clear shown" : "Clear"}</button>
            <button type="button" onClick={() => apply(new Set([...sel, ...visible.map((c) => c.config)]))}>
              {filtered ? "Select shown" : "Select all"}</button>
            <button type="button" className="wide" onClick={() => apply(new Set(defaults))} title={defaultNote}>Reset (to default)</button>
            {saveName === null
              ? <button type="button" onClick={() => setSaveName("")}>Save</button>
              : <span className="mp-save"><input autoFocus placeholder="Name" value={saveName} onChange={(e) => setSaveName(e.target.value)}
                       onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { e.stopPropagation(); setSaveName(null); } }} />
                  <button type="button" onClick={save} disabled={!saveName.trim()}>OK</button></span>}
            <button type="button" onClick={() => (saved ? setSaved(null) : loadSaved())}>Load</button>
          </div>
          {saved && (
            <div className="mp-saved">
              {saved.length ? saved.map((s) => (
                <span key={s.name} className="mp-saved-row">
                  <button type="button" className="link" onClick={() => { apply(new Set(s.configs)); setSaved(null); setMsg(`Loaded “${s.name}”`); }}>
                    {s.name}</button>
                  <span className="muted small">{s.configs.length}</span>
                  <button type="button" className="mp-x" title={`Delete “${s.name}”`} onClick={() => remove(s.name)}>×</button>
                </span>
              )) : <span className="muted small">No saved selections yet.</span>}
            </div>
          )}
          <p className="mp-note">{msg || defaultNote}</p>
        </div>
      )}
    </div>
  );
}
