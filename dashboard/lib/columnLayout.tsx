"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";

/**
 * A column a table offers. `width` is its default size in px. A `fixed` column keeps its px width;
 * the others are flexible: they share the space left over in proportion to their widths, so the
 * table always fits its container and follows it when the window or a side panel changes size.
 * No column gets narrower than `min` px (the table scrolls sideways instead).
 */
export interface ColDef { key: string; width: number; min?: number; fixed?: boolean }
/** what the server keeps per table (lib/uiLayout.ts) */
export interface SavedLayout { order?: string[]; widths?: Record<string, number> }

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
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ key: string; side: "before" | "after" } | null>(null);
  const resizing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ order, widths });
  latest.current = { order, widths };

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
  }, [cols.map((c) => c.key).join(), widths, box, reserve]);

  const width = (key: string) => px[key] ?? raw(key);
  const total = cols.reduce((s, c) => s + width(c.key), 0);
  const customised = order.join() !== defs.map((d) => d.key).join() || Object.keys(widths).length > 0;

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
        setWidths((w) => { const n = { ...w }; delete n[key]; return n; });
        persist();
      }}
      onPointerDown={(e: ReactPointerEvent<HTMLSpanElement>) => {
        e.preventDefault(); e.stopPropagation();
        resizing.current = true;
        const startX = e.clientX;
        const col = byKey.get(key)!;
        // a flexible column grows into its flexible neighbour (right, or left for the last one), so the table keeps fitting
        const flex = cols.filter((c) => !c.fixed);
        const at = flex.findIndex((c) => c.key === key);
        const other = col.fixed || box === null ? undefined : (flex[at + 1] ?? flex[at - 1]);
        const a = { key, px: width(key), w: raw(key), min: minOf(key) };
        const b = other && { key: other.key, px: width(other.key), w: raw(other.key), min: minOf(other.key) };
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        document.body.classList.add("col-resizing");
        const onMove = (ev: PointerEvent) => {
          let dx = ev.clientX - startX;
          if (!b) {   // fixed column (or not measured yet): plain px
            setWidths((w) => ({ ...w, [key]: Math.max(a.min, Math.round(a.w + dx)) }));
            return;
          }
          // the column grows by dx and its neighbour gives up the same, each kept at or above its minimum
          dx = Math.min(Math.max(dx, a.min - a.px), b.px - b.min);
          setWidths((w) => ({
            ...w,
            [a.key]: Math.max(1, Math.round((a.w * (a.px + dx)) / a.px)),
            [b.key]: Math.max(1, Math.round((b.w * (b.px - dx)) / b.px)),
          }));
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
