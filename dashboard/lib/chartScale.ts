// Scales shared by the trade-off charts (linear or log axes, nice ticks, zoom).

export function niceTicks(lo: number, hi: number, n = 6): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}
export function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); }
  }
  return out.length >= 4 ? out : niceTicks(lo, hi);      // zoomed in far: evenly spaced values read better
}
/** a scale's domain in "axis space": log10(value) on a log axis, the value itself otherwise */
export type Dom = [number, number];
export function autoDomain(vals: number[], log: boolean): Dom {
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (log) { lo = lo / 1.25; hi = hi * 1.25; } else { const pad = (hi - lo || Math.abs(hi) || 1) * 0.06; lo -= pad; hi += pad; }
  return log ? [Math.log10(lo), Math.log10(hi)] : [lo, hi];
}
export function scale(dom: Dom, log: boolean, r0: number, r1: number) {
  const [a, b] = dom;
  const f = log ? (v: number) => Math.log10(v) : (v: number) => v;
  const lo = log ? 10 ** a : a, hi = log ? 10 ** b : b;
  return {
    map: (v: number) => r0 + ((f(v) - a) / (b - a || 1)) * (r1 - r0),
    invert: (px: number) => a + ((px - r0) / (r1 - r0)) * (b - a),          // pixel -> axis space
    ticks: log ? logTicks(lo, hi) : niceTicks(lo, hi),
    r0, r1, dom,
  };
}
/** zoom a domain by `f` (<1 = in) around the axis-space point `at` */
export const zoomDom = ([a, b]: Dom, at: number, f: number): Dom => [at - (at - a) * f, at + (b - at) * f];
