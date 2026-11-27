"use client";

/**
 * Archiving rows on a page (Benchmark list, Yugos models, Datasets): archived rows leave the page's list,
 * charts and counts, show under "Archived" (newest archived first, so the last one is at the top) and can be restored.
 * Saved on the server (data/archive.json), shared by everyone using the dashboard.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";

export type ArchiveMap = Record<string, { at: string; label: string; note?: string }>;
export type ArchivePage = "benchmark-list" | "yugos-models" | "datasets";

interface Toast { text: string; undo?: () => void; error?: boolean }

/** the page's archive with archive / restore actions (saved at once; an "Undo" toast follows each one) */
export function useArchive(page: ArchivePage, initial: ArchiveMap, onArchived?: (ids: string[]) => void) {
  const [map, setMap] = useState<ArchiveMap>(initial);
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.error ? 10_000 : 8_000);
    return () => clearTimeout(t);
  }, [toast]);

  const send = async (body: object) => {
    const r = await fetch("/api/archive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    setMap(j.archived as ArchiveMap);
  };
  const name = (rows: { label: string }[]) => (rows.length === 1 ? `“${rows[0].label}”` : `${rows.length} rows`);

  const restore = async (ids: string[], quiet = false) => {
    const before = map;
    const rows = ids.map((id) => ({ id, label: map[id]?.label ?? id }));
    setMap((m) => { const n = { ...m }; ids.forEach((id) => delete n[id]); return n; });
    try {
      await send({ restore: ids });
      if (!quiet) setToast({ text: `Restored ${name(rows)}`, undo: () => archive(rows, true, before[ids[0]]?.note ?? "") });
    } catch (e) { setMap(before); setToast({ text: `Not restored: ${(e as Error).message}`, error: true }); }
  };
  const archive = async (rows: { id: string; label: string }[], quiet = false, note = "") => {
    const before = map;
    const at = new Date().toISOString();
    setMap((m) => ({ ...m, ...Object.fromEntries(rows.map((r) => [r.id, { at, label: r.label, ...(note.trim() ? { note: note.trim() } : {}) }])) }));
    try {
      await send({ archive: rows, note });
      onArchived?.(rows.map((r) => r.id));
      if (!quiet) setToast({ text: `Archived ${name(rows)}`, undo: () => restore(rows.map((r) => r.id), true) });
    } catch (e) { setMap(before); setToast({ text: `Not archived: ${(e as Error).message}`, error: true }); }
  };

  // every archive asks first
  const [confirm, setConfirm] = useState<{ rows: { id: string; label: string }[]; note?: string } | null>(null);
  const [reason, setReason] = useState("");
  const ask = (rows: { id: string; label: string }[], note?: string) => { setReason(""); setConfirm({ rows, note }); };
  const dialog = confirm && (
    <ConfirmDialog title={`Archive ${name(confirm.rows)}?`} confirmLabel="Archive" onCancel={() => setConfirm(null)}
                   onConfirm={() => { archive(confirm.rows, false, reason); setConfirm(null); }}>
      {confirm.note && <p>{confirm.note}</p>}
      <p className="muted">It leaves this page, its counts and charts. You can restore it any time from <b>Archived</b>.</p>
      <label className="arc-reason">
        <span>Reason <span className="muted">(optional)</span></span>
        <textarea rows={3} maxLength={2000} value={reason} autoFocus placeholder="Why is it archived? Everyone sees this in the Archived list."
                  onChange={(e) => setReason(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); archive(confirm.rows, false, reason); setConfirm(null); } }} />
        <span className="muted small">Ctrl+Enter archives</span>
      </label>
    </ConfirmDialog>
  );

  const toastEl = toast && (
    <div className={`arc-toast${toast.error ? " err" : ""}`} role="status">
      <span>{toast.text}</span>
      {toast.undo && <button type="button" className="link" onClick={() => { toast.undo!(); setToast(null); }}>Undo</button>}
      <button type="button" className="arc-toast-x" aria-label="Dismiss" onClick={() => setToast(null)}>×</button>
    </div>
  );
  return { map, count: Object.keys(map).length, ask, archive, restore, toast: toastEl, dialog };
}

/** "Active | Archived (N)" switch at the start of a page's toolbar */
export function ArchiveSwitch({ on, count, onChange, noun }: { on: boolean; count: number; onChange: (on: boolean) => void; noun: string }) {
  return (
    <span className="seg arc-switch" role="group" aria-label={`Active or archived ${noun}`}>
      <button type="button" className={!on ? "on" : ""} aria-pressed={!on} onClick={() => onChange(false)}>Active</button>
      <button type="button" className={on ? "on" : ""} aria-pressed={on} onClick={() => onChange(true)} title={`${noun} taken off this page; restore them from here`}>
        Archived <span className="arc-n">{count}</span>
      </button>
    </span>
  );
}

const BOX = (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    <rect x="1.75" y="2.5" width="12.5" height="3.5" rx="1" /><path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6M6.5 8.75h3" />
  </svg>
);

/** small archive button for a row (shown on hover / focus / selected row) */
export function ArchiveButton({ label, onClick, className = "" }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" className={`arc-btn ${className}`} title={`Archive ${label}`} aria-label={`Archive ${label}`}
            onClick={(e) => { e.stopPropagation(); onClick(); }} onKeyDown={(e) => e.stopPropagation()}>{BOX}</button>
  );
}

/** a labelled archive button (details panels) */
export function ArchiveAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" className="button arc-action" onClick={onClick}>{BOX} {children}</button>;
}

export interface ArchivedRow { id: string; label: string; detail?: ReactNode; search?: string }

function when(iso: string) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  const ago = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : mins < 48 * 60 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`, ago };
}

/** the Archived view: every archived row, newest archived first by default, each with Restore */
export function ArchivedTable({ map, rows, onRestore, noun, detailLabel = "Details" }: {
  map: ArchiveMap; rows: ArchivedRow[]; onRestore: (ids: string[]) => void; noun: string; detailLabel?: string;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: "at" | "name"; dir: 1 | -1 }>({ key: "at", dir: -1 });
  const all = useMemo(() => {
    const known = new Map(rows.map((r) => [r.id, r]));
    // rows the page no longer has still show, by the name they had when archived
    return Object.entries(map).map(([id, a]) => ({ ...(known.get(id) ?? { id, label: a.label, detail: <span className="muted">no longer in the source data</span>, search: "" } as ArchivedRow), at: a.at, note: a.note ?? "" }));
  }, [map, rows]);
  const t = q.trim().toLowerCase();
  const shown = all.filter((r) => !t || `${r.label} ${r.id} ${r.search ?? ""} ${r.note}`.toLowerCase().includes(t))
    .sort((a, b) => (sort.key === "at" ? a.at.localeCompare(b.at) : a.label.localeCompare(b.label)) * sort.dir || a.label.localeCompare(b.label));
  const head = (key: "at" | "name", label: string) => (
    <th aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button type="button" className="col-sort" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : key === "at" ? -1 : 1 }))}>
        {label} {sort.key === key ? (sort.dir === 1 ? "▲" : "▼") : ""}
      </button>
    </th>
  );
  return (
    <div className="arc">
      <div className="arc-bar">
        <input type="search" placeholder={`Search archived ${noun}…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search archived ${noun}`} />
        <span className="bl-total"><b>{shown.length}</b> of {all.length} archived {noun}</span>
      </div>
      {all.length === 0 ? (
        <p className="arc-empty muted">Nothing archived yet. Archive a row with its box button (on hover) to take it off the list; it will wait here to be restored.</p>
      ) : (
        <table className="arc-table">
          <thead><tr>{head("name", "Name")}<th>{detailLabel}</th><th>Reason</th>{head("at", "Archived")}<th aria-label="Restore" /></tr></thead>
          <tbody>
            {shown.map((r) => {
              const w = when(r.at);
              return (
                <tr key={r.id}>
                  <td className="arc-name">{r.label}</td>
                  <td className="arc-detail small">{r.detail}</td>
                  <td className="arc-note small">{r.note || <span className="muted">—</span>}</td>
                  <td className="arc-at small" title={r.at}>{w.date} <span className="muted">· {w.ago}</span></td>
                  <td className="arc-restore"><button type="button" className="button" onClick={() => onRestore([r.id])}>Restore</button></td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={5} className="muted">No archived {noun} match.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** a small modal: Enter / the main button confirms, Esc / Cancel / a click outside cancels */
function ConfirmDialog({ title, confirmLabel, onConfirm, onCancel, children }: {
  title: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void; children?: ReactNode;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onCancel]);
  return (
    <div className="arc-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="arc-dialog" role="alertdialog" aria-modal="true" aria-labelledby="arc-dialog-title">
        <h2 id="arc-dialog-title">{title}</h2>
        {children}
        <div className="arc-dialog-btns">
          <button type="button" className="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="button primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
