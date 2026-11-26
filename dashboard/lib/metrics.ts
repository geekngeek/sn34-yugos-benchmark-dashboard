/** Reporting parameters of a benchmark, as stored in the CSV's "Metrics detail" column. */

export const METRIC_KEYS = ["quality", "cost", "time", "speed", "tokens", "uncertainty", "runs", "effort",
                            "date", "breakdown", "votes", "other"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export const METRIC_INFO: Record<MetricKey, { short: string; title: string; help: string }> = {
  quality: { short: "score", title: "Score", help: "The main score and its unit" },
  cost: { short: "$", title: "Cost", help: "Money: cost per task, total run cost or token prices" },
  time: { short: "time", title: "Time", help: "Latency, time per task or total run time" },
  speed: { short: "tok/s", title: "Speed", help: "Output tokens per second" },
  tokens: { short: "tokens", title: "Tokens", help: "Token usage per task or per run" },
  uncertainty: { short: "±", title: "±CI", help: "Confidence intervals, ± errors or score ranges" },
  runs: { short: "runs", title: "Runs", help: "Repeated runs or attempts: pass@k, trials" },
  effort: { short: "effort", title: "Effort", help: "Separate entries per setting: reasoning effort, tools, agent" },
  date: { short: "date", title: "Date", help: "Evaluation, submission or release date per entry" },
  breakdown: { short: "split", title: "Split", help: "Per-category or per-subset scores" },
  votes: { short: "votes", title: "Votes", help: "Human preference data: votes, battles, win rates" },
  other: { short: "+", title: "Other", help: "Other per-entry fields" },
};

export type Where = "page" | "data" | "paper";
export interface Metric { key: MetricKey; where: Where; label: string; detail: string; evidence: string }
export interface Metrics { params: Metric[]; notReported: MetricKey[]; note: string }

const isKey = (k: string): k is MetricKey => (METRIC_KEYS as readonly string[]).includes(k);

/** Parse lines like "Cost [page]: Avg. $ — USD per task · https://…", "Not reported: a, b", "Note: …". */
export function parseMetrics(detail: string): Metrics {
  const out: Metrics = { params: [], notReported: [], note: "" };
  for (const line of detail.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const nr = line.match(/^Not reported:\s*(.*)$/i);
    if (nr) { out.notReported = nr[1].split(/,\s*/).map((k) => k.trim().toLowerCase()).filter(isKey); continue; }
    const note = line.match(/^Note:\s*(.*)$/i);
    if (note) { out.note = note[1]; continue; }
    const m = line.match(/^(\w+)\s*\[(page|data|paper)\]:\s*(.*)$/i);
    if (!m || !isKey(m[1].toLowerCase())) continue;
    let rest = m[3];
    let evidence = "";
    const ev = rest.match(/\s·\s(https?:\/\/\S+)$/);
    if (ev) { evidence = ev[1]; rest = rest.slice(0, ev.index); }
    const [label, ...detailParts] = rest.split(" — ");
    out.params.push({ key: m[1].toLowerCase() as MetricKey, where: m[2].toLowerCase() as Where,
                      label: label.trim(), detail: detailParts.join(" — ").trim(), evidence });
  }
  return out;
}

/** best "where" per key ("page" beats data/paper); keys in fixed order */
export function reportedKeys(m: Metrics): { key: MetricKey; where: Where; count: number }[] {
  const by = new Map<MetricKey, { where: Where; count: number }>();
  for (const p of m.params) {
    const cur = by.get(p.key);
    by.set(p.key, { where: cur?.where === "page" || p.where === "page" ? "page" : p.where, count: (cur?.count ?? 0) + 1 });
  }
  return METRIC_KEYS.filter((k) => by.has(k)).map((k) => ({ key: k, ...by.get(k)! }));
}
