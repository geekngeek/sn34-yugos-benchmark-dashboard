"use client";

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Spreadsheet-style cell expansion: when the pointer is over a cell marked `data-tip` whose
 * content is cut off ("…"), the same content is shown in full right on top of the cell —
 * same font, colours and look, just wide enough (wrapping only past ~520px). Nothing extra.
 */
export function HoverTip({ children, className }: { children: ReactNode; className?: string }) {
  const [tip, setTip] = useState<{ html: string; cls: string; left: number; top: number; width: number; height: number;
                                   style: React.CSSProperties } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const current = useRef<Element | null>(null);

  const hide = useCallback(() => { current.current = null; setTip(null); }, []);

  const onOver = (e: React.MouseEvent) => {
    const el = (e.target as Element).closest?.("[data-tip]") as HTMLElement | null;
    if (el === current.current) return;
    current.current = el;
    if (!el || el.scrollWidth <= el.clientWidth + 1) { setTip(null); return; }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // the cell's own background, or the nearest ancestor's (so it looks like the cell grew)
    let bg = cs.backgroundColor, p: HTMLElement | null = el;
    while (p && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) { p = p.parentElement; bg = p ? getComputedStyle(p).backgroundColor : bg; }
    setTip({ html: el.innerHTML, cls: el.className, left: r.left, top: r.top, width: r.width, height: r.height,
             style: { background: `linear-gradient(${bg}, ${bg}), var(--surface)`,   // row tints are see-through: lay them on a solid base
                       color: cs.color, fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
                      lineHeight: cs.lineHeight, textAlign: cs.textAlign as React.CSSProperties["textAlign"],
                      padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}` } });
  };

  // keep the expanded cell inside the window
  useLayoutEffect(() => {
    const b = box.current;
    if (!b || !tip) return;
    const w = b.offsetWidth, h = b.offsetHeight;
    b.style.left = `${Math.max(4, Math.min(tip.left, window.innerWidth - w - 4))}px`;
    b.style.top = `${Math.max(4, Math.min(tip.top, window.innerHeight - h - 4))}px`;
    b.style.visibility = "visible";
  }, [tip]);

  return (
    <div className={className} onMouseOver={onOver} onMouseLeave={hide} onScrollCapture={hide}>
      {children}
      {tip && (
        <div ref={box} aria-hidden="true" className={`hovertip ${tip.cls}`}
             style={{ ...tip.style, visibility: "hidden", minWidth: tip.width, minHeight: tip.height }}
             dangerouslySetInnerHTML={{ __html: tip.html }} />
      )}
    </div>
  );
}
