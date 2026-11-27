// Label placement for the scatter charts: every dot gets a label, put in the nearest free gap around it.
// Each label tries 8 directions (right, left, above, below, then the diagonals) at growing distances; the first
// spot that stays inside the plot and touches no other label or dot wins. Labels further than the first ring get
// a thin leader line back to their dot. If no free spot exists, the spot with the least overlap is used and the
// label is marked crowded (the charts draw it faint until its model is hovered; zooming in gives it room).

export interface LabelIn { key: string; x: number; y: number; r: number; text: string; dim?: boolean }
export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface LabelOut { key: string; text: string; tx: number; ty: number; box: Box; leader: [number, number, number, number] | null;
  crowded: boolean }   // no free gap was found: it overlaps something (drawn faint)

const H0 = 15;                    // label box height (12px text); a boxed label passes its own
const RINGS = [3, 10, 20, 34, 52, 76, 104];
// direction -> where the box sits relative to the dot, at distance d
const DIRS: ((px: number, py: number, d: number, w: number, H: number) => Box)[] = [
  (px, py, d, w, H) => ({ x0: px + d, x1: px + d + w, y0: py - H / 2, y1: py + H / 2 }),                       // right
  (px, py, d, w, H) => ({ x0: px - d - w, x1: px - d, y0: py - H / 2, y1: py + H / 2 }),                       // left
  (px, py, d, w, H) => ({ x0: px - w / 2, x1: px + w / 2, y0: py - d - H, y1: py - d }),                       // above
  (px, py, d, w, H) => ({ x0: px - w / 2, x1: px + w / 2, y0: py + d, y1: py + d + H }),                       // below
  (px, py, d, w, H) => ({ x0: px + d * 0.7, x1: px + d * 0.7 + w, y0: py - d * 0.7 - H, y1: py - d * 0.7 }),   // up right
  (px, py, d, w, H) => ({ x0: px + d * 0.7, x1: px + d * 0.7 + w, y0: py + d * 0.7, y1: py + d * 0.7 + H }),   // down right
  (px, py, d, w, H) => ({ x0: px - d * 0.7 - w, x1: px - d * 0.7, y0: py - d * 0.7 - H, y1: py - d * 0.7 }),   // up left
  (px, py, d, w, H) => ({ x0: px - d * 0.7 - w, x1: px - d * 0.7, y0: py + d * 0.7, y1: py + d * 0.7 + H }),   // down left
];

let ctx: CanvasRenderingContext2D | null | undefined;
/** the text's width at 12px in the page's font (an estimate on the server) */
export function textWidth(text: string): number {
  if (ctx === undefined) {
    ctx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    if (ctx) ctx.font = `12px ${getComputedStyle(document.body).fontFamily || "sans-serif"}`;
  }
  return ctx ? ctx.measureText(text).width + 2 : text.length * 6.8;
}

const CELL = 48;
class Grid {
  private m = new Map<string, Box[]>();
  private cells(b: Box, f: (k: string) => void) {
    for (let i = Math.floor(b.x0 / CELL); i <= Math.floor(b.x1 / CELL); i++)
      for (let j = Math.floor(b.y0 / CELL); j <= Math.floor(b.y1 / CELL); j++) f(`${i},${j}`);
  }
  add(b: Box) { this.cells(b, (k) => { const l = this.m.get(k); if (l) l.push(b); else this.m.set(k, [b]); }); }
  /** total overlapping area with what is already placed (0 = free) */
  hit(b: Box, skip?: Box): number {
    let a = 0;
    const seen = new Set<Box>();
    this.cells(b, (k) => {
      for (const o of this.m.get(k) ?? []) {
        if (o === skip || seen.has(o)) continue;
        seen.add(o);
        const w = Math.min(b.x1, o.x1) - Math.max(b.x0, o.x0), h = Math.min(b.y1, o.y1) - Math.max(b.y0, o.y0);
        if (w > 0 && h > 0) a += w * h;
      }
    });
    return a;
  }
}

/** place a label for every item, in the given order (most important first) */
export function placeLabels(items: LabelIn[], bounds: Box, opts: { padX?: number; h?: number; obstacles?: Box[] } = {}): LabelOut[] {
  const H = opts.h ?? H0, padX = opts.padX ?? 0;
  const grid = new Grid();
  for (const b of opts.obstacles ?? []) grid.add(b);   // marks that get no label but must not be covered (e.g. other dots)
  const dotBox = new Map<string, Box>();
  for (const it of items) {
    const b = { x0: it.x - it.r, x1: it.x + it.r, y0: it.y - it.r, y1: it.y + it.r };
    dotBox.set(it.key, b);
    grid.add(b);
  }
  const out: LabelOut[] = [];
  for (const it of items) {
    const w = textWidth(it.text) + padX * 2;
    let best: { b: Box; ring: number; cost: number } | null = null;
    search: for (let ri = 0; ri < RINGS.length; ri++) {
      const d = it.r + RINGS[ri];
      for (const dir of DIRS) {
        const b = dir(it.x, it.y, d, w, H);
        const outside = Math.max(0, bounds.x0 - b.x0) + Math.max(0, b.x1 - bounds.x1) + Math.max(0, bounds.y0 - b.y0) + Math.max(0, b.y1 - bounds.y1);
        const cost = grid.hit(b, dotBox.get(it.key)) + outside * 400 + ri * 2;
        if (!best || cost < best.cost) best = { b, ring: ri, cost };
        if (cost === ri * 2) break search;           // free spot
      }
    }
    const b = best!.b;
    grid.add(b);
    // a label away from its dot points back to it: from the dot's edge to the nearest point of the box
    let leader: LabelOut["leader"] = null;
    if (best!.ring >= 2) {
      const nx = Math.max(b.x0, Math.min(it.x, b.x1)), ny = Math.max(b.y0, Math.min(it.y, b.y1));
      const len = Math.hypot(nx - it.x, ny - it.y) || 1;
      leader = [it.x + ((nx - it.x) / len) * (it.r + 1), it.y + ((ny - it.y) / len) * (it.r + 1), nx, ny];
    }
    out.push({ key: it.key, text: it.text, tx: b.x0 + 1 + padX, ty: b.y1 - 3 - (H - H0) / 2, box: b, leader, crowded: best!.cost - best!.ring * 2 > 12 });
  }
  return out;
}
