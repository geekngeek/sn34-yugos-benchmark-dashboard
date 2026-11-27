"use client";

import { useEffect, useRef, useState } from "react";

/** a column's filter popup, under its header; closes on a click outside, Escape, or the header's ▾ again */
export function FilterPop({ anchor, onClose, children }: { anchor: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const W = 270;
    const place = () => {
      const el = document.querySelector(`[data-pop="${CSS.escape(anchor)}"]`);
      const head = el?.closest("[role=columnheader], th") ?? el;
      if (!head) { close.current(); return; }
      const r = head.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 320;
      // below the anchor when it fits, else above it
      const top = r.bottom + 4 + h <= window.innerHeight - 8 ? r.bottom + 4 : Math.max(8, r.top - 4 - h);
      setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - W - 8)), top });
    };
    place();
    const down = (e: MouseEvent) => {
      const t = e.target as Element;
      if (ref.current?.contains(t) || t.closest?.(`[data-pop="${CSS.escape(anchor)}"]`)) return;
      close.current();
    };
    const key = (e: { key: string }) => { if (e.key === "Escape") close.current(); };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [anchor]);
  return (
    <div ref={ref} className="hf-pop" role="dialog" aria-label="Column filter"
         style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}>{children}</div>
  );
}

export interface Chip { key: string; label: string; clear: () => void; open?: () => void }

/**
 * Active filters (and the sort) as chips: click a chip to change it, × removes it, "Clear all" removes every one.
 * With nothing active it shows a short hint instead.
 */
export function FilterChips({ chips, sort, onClearAll, hint, children }: {
  chips: Chip[]; sort?: { label: string; reverse: () => void; clear: () => void } | null; onClearAll: () => void;
  hint?: React.ReactNode; children?: React.ReactNode;
}) {
  const any = chips.length > 0 || !!sort;
  return (
    <div className="bl-chips" role="group" aria-label="Active filters and sort">
      {!any ? <span className="muted small">{hint ?? <>No filters. Click a column name to sort, or its <span className="hf-icon" aria-hidden="true">▾</span> to filter.</>}</span> : <>
        {chips.map((c) => (
          <span key={c.key} className="bl-chip">
            <button type="button" className="bl-chip-label" title={c.open ? "Change this filter" : undefined} onClick={() => c.open?.()}>{c.label}</button>
            <button type="button" className="bl-chip-x" aria-label={`Remove ${c.label}`} onClick={c.clear}>×</button>
          </span>))}
        {sort && <span className="bl-chip sort">
          <button type="button" className="bl-chip-label" title="Reverse" onClick={sort.reverse}>{sort.label}</button>
          <button type="button" className="bl-chip-x" aria-label="Stop sorting" onClick={sort.clear}>×</button>
        </span>}
        <button type="button" className="link" onClick={onClearAll}>Clear all</button>
      </>}
      {children}
    </div>
  );
}

/** the ▾ button in a column header that opens its filter popup; solid when the filter is on */
export function FilterButton({ col, label, on, open, onToggle }: { col: string; label: string; on: boolean; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={`col-filter${on ? " on" : ""}`} draggable={false} aria-label={`Filter ${label}`} aria-expanded={open} data-pop={col}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}>▾</button>
  );
}
