/** Difficulty levels 1..5 as stored in the benchmark list CSV ("Difficulty" and "Difficulty detail" columns).
 *  "3" = level 3 · "2-3" = between 2 and 3 · "≤3" = at most 3 · "≥4" = at least 4 · "n/a" = cannot be levelled · "" = not assessed */

export interface Difficulty { lo: number; hi: number; kind: "firm" | "range" | "none" | "na"; raw: string; detail: string }

export const LEVEL_NAMES = ["", "Basic", "Standard", "Advanced", "Expert", "Unsolved"];
export const LEVEL_HELP = [
  "",
  "L1 Basic: even small/older models (GPT-3.5, Llama-3-8B class) solve about half or more",
  "L2 Standard: 2024 flagships (GPT-4o, Claude 3.5 Sonnet) solve about half; small models don't",
  "L3 Advanced: late-2025 frontier (GPT-5, Claude 4.5 Opus, Gemini 3 Pro) solves about half; 2024 flagships don't",
  "L4 Expert: only the Nov-2026 frontier solves about half",
  "L5 Unsolved: even the Nov-2026 frontier solves less than half",
];

export function parseDifficulty(raw: string, detail: string): Difficulty {
  const v = raw.trim().replace(/\s+/g, "");
  let m;
  if (!v) return { lo: 0, hi: 0, kind: "none", raw, detail };
  if (/^n\/?a$/i.test(v)) return { lo: 0, hi: 0, kind: "na", raw, detail };
  if ((m = v.match(/^([1-5])$/))) return { lo: +m[1], hi: +m[1], kind: "firm", raw, detail };
  if ((m = v.match(/^([1-5])[-–]([1-5])$/))) return { lo: Math.min(+m[1], +m[2]), hi: Math.max(+m[1], +m[2]), kind: "range", raw, detail };
  if ((m = v.match(/^(≤|<=)([1-5])$/))) return { lo: 1, hi: +m[2], kind: "range", raw, detail };
  if ((m = v.match(/^(≥|>=)([1-5])$/))) return { lo: +m[2], hi: 5, kind: "range", raw, detail };
  return { lo: 0, hi: 0, kind: "none", raw, detail };
}

/** the span of levels covered by a parent's sub-benchmarks (assessed ones only) */
export function spanOf(children: Difficulty[], own: Difficulty): Difficulty {
  const known = children.filter((d) => d.kind === "firm" || d.kind === "range");
  if (!known.length) return own;
  const lo = Math.min(...known.map((d) => d.lo)), hi = Math.max(...known.map((d) => d.hi));
  const counts = [1, 2, 3, 4, 5].map((L) => known.filter((d) => d.kind === "firm" && d.lo === L).length);
  return { lo, hi, kind: lo === hi ? "firm" : "range", raw: lo === hi ? `${lo}` : `${lo}-${hi}`,
           detail: `Sub-benchmarks span L${lo}–L${hi}. Firm levels: ${counts.map((c, k) => `L${k + 1}×${c}`).join(" · ")}. `
                   + `${known.length} of ${children.length} sub-benchmarks levelled.` };
}

export function difficultyText(d: Difficulty): string {
  if (d.kind === "na") return "Cannot be levelled";
  if (d.kind === "none") return "Not assessed yet";
  if (d.lo === d.hi) return `Level ${d.lo} · ${LEVEL_NAMES[d.lo]}`;
  return `Level ${d.lo}–${d.hi} (${LEVEL_NAMES[d.lo]} to ${LEVEL_NAMES[d.hi]})`;
}
