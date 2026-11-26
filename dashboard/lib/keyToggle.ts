// Clicking an entry in a chart key (benchmarks, developers, …). `off` lists the entries switched off.
// - Everything on: the click keeps only that entry ("show only this one").
// - Otherwise: the click switches that entry on or off.
// - Switching off the last one that is on brings every entry back.

export function keyClick(all: string[], off: string[], k: string): string[] {
  const offSet = new Set(off.filter((o) => all.includes(o)));
  if (offSet.size === 0) return all.filter((a) => a !== k);
  if (offSet.has(k)) offSet.delete(k); else offSet.add(k);
  return offSet.size >= all.length ? [] : all.filter((a) => offSet.has(a));
}

/** the tooltip that says what a click will do */
export function keyClickHint(all: string[], off: string[], k: string, verbs: { on: string; off: string }): string {
  const anyOff = off.some((o) => all.includes(o));
  if (!anyOff) return `Click to show only this one · hover to highlight`;
  if (off.includes(k)) return `Click to ${verbs.on}`;
  const onCount = all.length - off.filter((o) => all.includes(o)).length;
  return onCount === 1 ? "Click to show all again" : `Click to ${verbs.off} · hover to highlight`;
}
