"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";

/**
 * A column a table offers. `width` is its default size in px. Until the user resizes a column, the table
 * fits its container: a `fixed` column keeps its px width and the flexible ones share what is left, following
 * the window or a side panel. The first resize freezes every column at its current px size; from then on a
 * drag changes only the grabbed column and the table scrolls sideways when wider than its box ("Reset columns"
 * goes back to fitting). No column gets narrower than `min` px.
 */
export interface ColDef { key: string; width: number; min?: number; fixed?: boolean }
/** what the server keeps per table (lib/uiLayout.ts) */
export interface SavedLayout { order?: string[]; widths?: Record<string, number>; px?: boolean }

const SAVE_DELAY = 400;

/**
 * Column order and widths for one table, changed by dragging headers and their right-edge grip,
 * and saved on the server (POST /api/ui-layout) so every visit and every browser gets them.
 *
 *   const cl = useColumnLayout("yugos-models", DEFS, savedLayout);
 *   cl.cols                -> the columns in display order
 *   cl.width(key)          -> current width in px
 *   <th {...cl.head(key)}>Label {cl.grip(key)}</th>
 *   <div ref={cl.root}>…table…</div>   the element whose width the columns share
 *   (reserve: px taken by extra columns the layout doesn't manage, e.g. a checkbox column)
 */
export function useColumnLayout(id: string, defs: ColDef[], saved?: SavedLayout, reserve = 0) {
  const byKey = useMemo(() => new Map(defs.map((d) => [d.key, d])), [defs]);

  // saved order, minus columns that no longer exist, plus new columns at their default place
  const initialOrder = useMemo(() => {
    const known = (saved?.order ?? []).filter((k) => byKey.has(k));
    for (const d of defs) {
      if (known.includes(d.key)) continue;
      const i = defs.indexOf(d);
      const after = defs.slice(0, i).reverse().find((p) => known.includes(p.key));
      known.splice(after ? known.indexOf(after.key) + 1 : 0, 0, d.key);
    }
    return known;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [order, setOrder] = useState<string[]>(initialOrder);
  const [widths, setWidths] = useState<Record<string, number>>(() => ({ ...(saved?.widths ?? {}) }));
  // true once the user has resized a column: widths are plain px and no longer stretch to fit the box
  const [pxMode, setPxMode] = useState(saved?.px === true);
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ key: string; side: "before" | "after" } | null>(null);
  const resizing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ order, widths, px: pxMode });
  latest.current = { order, widths, px: pxMode };

  const send = useCallback(() => {
    timer.current = null;
    fetch("/api/ui-layout", {
      method: "POST", headers: { "content-type": "application/json" }, keepalive: true,   // survives leaving the page
      body: JSON.stringify({ id, ...latest.current }),
    }).catch(() => undefined);
  }, [id]);
  const persist = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(send, SAVE_DELAY);
  }, [send]);
  // leaving the page (or switching tab) with a save still waiting: send it now rather than lose it
  useEffect(() => {
    const flush = () => { if (timer.current) { clearTimeout(timer.current); send(); } };
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, [send]);

  // the container's inner width, followed as it changes (window resize, side panel opening, …)
  const [box, setBox] = useState<number | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const root = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    const measure = () => setBox(el.clientWidth);
    observer.current = new ResizeObserver(measure);
    observer.current.observe(el);
    measure();
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);

  const minOf = (key: string) => byKey.get(key)?.min ?? 40;
  /** saved size: px for a fixed column, a weight (px at the default scale) for a flexible one */
  const raw = (key: string) => widths[key] ?? byKey.get(key)?.width ?? 100;
  const cols = order.map((k) => byKey.get(k)!).filter(Boolean);

  // actual px per column: fixed ones as saved, flexible ones share what is left (whole px, remainder to the last)
  const px = useMemo(() => {
    const out: Record<string, number> = {};
    if (pxMode) { for (const c of cols) out[c.key] = Math.max(minOf(c.key), raw(c.key)); return out; }
    const flex = cols.filter((c) => !c.fixed);
    const fixedSum = cols.filter((c) => c.fixed).reduce((s, c) => s + raw(c.key), 0);
    const weight = flex.reduce((s, c) => s + raw(c.key), 0);
    const avail = box === null ? null : box - reserve - fixedSum;
    for (const c of cols) out[c.key] = c.fixed || avail === null || avail <= 0 || !weight ? raw(c.key) : 0;
    if (avail !== null && avail > 0 && weight) {
      let used = 0;
      for (const c of flex) { out[c.key] = Math.max(minOf(c.key), Math.floor((avail * raw(c.key)) / weight)); used += out[c.key]; }
      const last = flex[flex.length - 1];
      if (last && used < avail) out[last.key] += avail - used;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols.map((c) => c.key).join(), widths, box, reserve, pxMode]);

  const width = (key: string) => px[key] ?? raw(key);
  const total = cols.reduce((s, c) => s + width(c.key), 0);
  const customised = pxMode || order.join() !== defs.map((d) => d.key).join() || Object.keys(widths).length > 0;

  const move = (from: string, to: string, side: "before" | "after") => {
    if (from === to) return;
    setOrder((o) => {
      const rest = o.filter((k) => k !== from);
      const at = rest.indexOf(to) + (side === "after" ? 1 : 0);
      return [...rest.slice(0, at), from, ...rest.slice(at)];
    });
    persist();
  };

  const reset = () => {
    setOrder(defs.map((d) => d.key));
    setWidths({});
    setPxMode(false);
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    fetch("/api/ui-layout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, reset: true }) })
      .catch(() => undefined);
  };

  /** props for a header cell: drag it onto another header to move the column */
  const head = (key: string) => ({
    draggable: true,
    "data-col": key,
    className: `col-head${drag === key ? " col-dragging" : ""}${drop?.key === key ? ` col-drop-${drop.side}` : ""}`,
    onDragStart: (e: DragEvent) => {
      if (resizing.current) { e.preventDefault(); return; }
      setDrag(key);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/x-col", key);
    },
    onDragOver: (e: DragEvent) => {
      if (!drag || drag === key) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const side = e.clientX < r.left + r.width / 2 ? "before" : "after";
      if (drop?.key !== key || drop.side !== side) setDrop({ key, side });
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDrop((d) => (d?.key === key ? null : d));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (drag && drop) move(drag, key, drop.side);
      setDrag(null); setDrop(null);
    },
    onDragEnd: () => { setDrag(null); setDrop(null); },
  });

  /** the resize handle on a header's right edge; double-click puts the default width back */
  const grip = (key: string) => (
    <span className="col-grip" role="separator" aria-orientation="vertical" aria-label="Resize column" title="Drag to resize · double-click to reset"
      draggable={false}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        // its default size; in fitting mode the others share the rest as before, frozen ones stay put
        setWidths((w) => { const n = { ...w }; if (pxMode) n[key] = byKey.get(key)?.width ?? 100; else delete n[key]; return n; });
        persist();
      }}
      onPointerDown={(e: ReactPointerEvent<HTMLSpanElement>) => {
        e.preventDefault(); e.stopPropagation();
        resizing.current = true;
        const startX = e.clientX, start = width(key), min = minOf(key);
        // first resize: freeze every column at the size it has on screen now, so only the grabbed one moves
        if (!pxMode) {
          setWidths(Object.fromEntries(cols.map((c) => [c.key, width(c.key)])));
          setPxMode(true);
        }
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        document.body.classList.add("col-resizing");
        const onMove = (ev: PointerEvent) => {
          setWidths((w) => ({ ...w, [key]: Math.max(min, Math.round(start + ev.clientX - startX)) }));
        };
        const onUp = () => {
          resizing.current = false;
          document.body.classList.remove("col-resizing");
          el.removeEventListener("pointermove", onMove);
          el.removeEventListener("pointerup", onUp);
          el.removeEventListener("pointercancel", onUp);
          persist();
        };
        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerup", onUp);
        el.addEventListener("pointercancel", onUp);
      }} />
  );

  return { cols, width, total, head, grip, reset, customised, root };
}

/** a small "Reset columns" link, shown only when the layout differs from the default */
export function ResetColumns({ layout }: { layout: { customised: boolean; reset: () => void } }) {
  if (!layout.customised) return null;
  return (
    <button type="button" className="link col-reset" onClick={layout.reset} title="Put the columns back in their default order and widths">
      Reset columns
    </button>
  );
}
