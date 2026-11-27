"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import type { Freshness, RouterBenchmark, Usefulness } from "@/lib/routerBenchmarks";
import { PUBLIC_FIELDS, type PublicStatus } from "@/lib/routerPublicFields";
import { HoverTip } from "@/components/HoverTip";
import { NoteCell } from "@/components/NoteCell";
import { modelMatches, normText, textMatches, tokens } from "@/lib/modelSearch";
import { ColumnsMenu, DensityToggle, useColumnLayout, type ColDef, type SavedLayout } from "@/lib/columnLayout";
import { FilterButton, FilterChips, FilterPop, type Chip } from "@/components/FilterPop";
import { qFlag, qMany, qOne, useQuerySync, type Query } from "@/lib/urlState";

type SortKey = "num" | "name" | "newest" | "yugos";

const USE_RANK: Record<Usefulness, number> = { High: 0, Medium: 1, "Low–Medium": 2, Low: 3, No: 4, "?": 5 };
const NEW_RANK: Record<Freshness, number> = { Yes: 0, Partly: 1, Unknown: 2, No: 3 };
const USE_LEVELS: Usefulness[] = ["High", "Medium", "Low–Medium", "Low", "No"];
const NEW_LEVELS: Freshness[] = ["Yes", "Partly", "Unknown", "No"];

// columns in their default order and width (px); the user can drag and resize them (saved on the server)
const COLS: ColDef[] = [
  { key: "num", width: 46, min: 40, fixed: true }, { key: "name", width: 220, min: 120 }, { key: "note", width: 180, min: 70, hidden: true }, { key: "public", width: 200, min: 150 },
  { key: "creators", width: 190, min: 90, hidden: true }, { key: "scale", width: 220, min: 120 }, { key: "models", width: 220, min: 100 },
  { key: "focus", width: 220, min: 100 }, { key: "newest", width: 130, min: 110, fixed: true }, { key: "yugos", width: 120, min: 100, fixed: true },
  { key: "finding", width: 320, min: 120 },
];
const HEADS: Record<string, { label: string; sort?: SortKey; title?: string }> = {
  num: { label: "#", sort: "num" }, name: { label: "Benchmark", sort: "name" },
  note: { label: "Feedback note", title: "Your own note on this benchmark: click a cell to write; Enter saves, Shift+Enter adds a line, Esc cancels." },
  creators: { label: "Creators / year" }, scale: { label: "Scale" }, models: { label: "Model pool", title: "Blue: newest generation. Red outline: a model the Yugos router uses. +N: the rest of the pool (hover to list)." }, focus: { label: "Focus / stored data" },
  newest: { label: "Newest models", sort: "newest", title: "Has GPT-6 / Claude 5.x / Gemini 4 / DeepSeek V4-era models" },
  yugos: { label: "For Yugos", sort: "yugos", title: "How useful for building the Yugos router" },
  public: { label: "Public", title: "Which fields can be downloaded per question (✓ yes, ◐ partly, ✕ no, ? not stated), and the licence (blue open, grey mixed, red none). Dotted underline: hover for details." },
  finding: { label: "Key finding" },
};

const STATUS_MARK: Record<PublicStatus, string> = { Yes: "✓", Partial: "◐", No: "✕", "?": "?" };
const STATUS_WORD: Record<PublicStatus, string> = { Yes: "public", Partial: "partly public", No: "not public", "?": "not stated" };

/** open licence, no licence, or something in between (mixed, unverified, rules) */
function licenceKind(text: string): "open" | "none" | "mixed" {
  const t = text.toLowerCase();
  if (t === "?" || t.startsWith("none") || t.startsWith("data none") || t.startsWith("? ")) return "none";
  const open = /\b(mit|apache|cc[- ]by|cdla)/.test(t);
  return open && !/(none|\?|unverified|rule)/.test(t) ? "open" : "mixed";
}

/** GPT-6, Claude 5.x (Opus/Sonnet/Fable 5), Gemini 4, DeepSeek V4: the "newest models" generation */
const NEWEST = /gpt-?6|(opus|sonnet|fable|haiku|mythos)[ -]?5|claude-(opus|sonnet|fable|haiku)-5|gemini[ -]?4|deepseek[ -]?v4/i;

const SHOW_MODELS = 4;   // tags shown before the "+N" tag

function ModelTags({ b, hits = [] }: { b: RouterBenchmark; hits?: string[] }) {
  const pool = b.pool;
  if (!pool?.models.length) return <span className="subtle" title={b.models}>{b.models || "—"}</span>;
  // models matching the search come first and are highlighted
  const order = hits.length ? [...hits, ...pool.models.filter((m) => !hits.includes(m))] : pool.models;
  const shown = order.slice(0, Math.max(SHOW_MODELS, hits.length));
  const yugos = pool.yugos ?? {};
  const hiddenYugos = pool.models.filter((m) => yugos[m] && !shown.includes(m)).length;
  // models not shown: the rest of the pool when its size is known, else the rest of the list
  const rest = (pool.total ?? pool.models.length) - shown.length;
  const tip = [`${pool.total === null ? "Pool size not stated" : `${pool.approx ? "About " : ""}${pool.total.toLocaleString("en-US")} models`}`,
               pool.note, hiddenYugos ? `${hiddenYugos} more that Yugos uses` : "",
               `All listed: ${pool.models.map((m) => (yugos[m] ? `${m} (Yugos)` : m)).join(", ")}`].filter(Boolean).join("\n");
  const tag = (m: string) => {
    const yid = yugos[m];
    const t = [m, NEWEST.test(m) ? "newest generation" : "", yid ? `Yugos uses it (${yid})` : ""].filter(Boolean).join(" — ");
    return <span key={m} className={`rb-tag m-model${NEWEST.test(m) ? " m-newest" : ""}${yid ? " m-yugos" : ""}${hits.includes(m) ? " m-hit" : ""}`} title={t}>{m}</span>;
  };
  const unnamed = pool.total !== null ? pool.total - pool.models.length : 0;
  return (
    <>
    <span className="rb-pool-full">
      {pool.models.map(tag)}
      {unnamed > 0 && <span className="rb-tag m-rest">+{pool.approx ? "~" : ""}{unnamed.toLocaleString("en-US")} not named</span>}
      {pool.total === null && pool.approx && <span className="rb-tag m-rest">+ more</span>}
    </span>
    <span className="rb-pool">
      <span className="rb-pool-strip">{shown.map(tag)}</span>
      {rest > 0 && <span className={`rb-tag m-rest${hiddenYugos ? " m-yugos" : ""}`} title={tip}>+{pool.approx ? "~" : ""}{rest.toLocaleString("en-US")}</span>}
      {rest <= 0 && pool.total === null && pool.approx && <span className="rb-tag m-rest" title={tip}>+ more</span>}
    </span>
    </>
  );
}

function PublicTags({ b }: { b: RouterBenchmark }) {
  if (!b.public) return <span className="subtle">—</span>;
  return (
    <span className="rb-tags">
      {PUBLIC_FIELDS.map((f) => {
        const { status, note } = b.public![f];
        return (
          <span key={f} className={`rb-pq s-${cls(status === "?" ? "unknown" : status)}${note ? " has-note" : ""}`}
                title={`${f}: ${STATUS_WORD[status]}${note ? ` — ${note}` : ""}`} aria-label={`${f}: ${STATUS_WORD[status]}`}>
            {f[0]}
          </span>
        );
      })}
      {b.licence && (
        <span className={`rb-tag lic-${licenceKind(b.licence)}`} title={`Licence: ${b.licence}`}>{b.licence}</span>
      )}
    </span>
  );
}

const cls = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "-");

/* ---------- tiny markdown renderer for the research write-ups (headings, lists, tables, code, links, bold) ---------- */

function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\((https?:[^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|(https?:\/\/[^\s)|]+)/g;
  let last = 0, m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<a key={k} href={m[2]} target="_blank" rel="noreferrer">{m[1]}</a>);
    else if (m[3]) out.push(<strong key={k}>{inline(m[3], k)}</strong>);
    else if (m[4]) out.push(<code key={k}>{m[4]}</code>);
    else if (m[5]) out.push(<a key={k} href={m[5]} target="_blank" rel="noreferrer">{m[5]}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const tableCells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `b${i}`;
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("```")) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) body.push(lines[i]);
      i++;
      blocks.push(<pre key={k}>{body.join("\n")}</pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = Math.min(h[1].length + 1, 5);
      const Tag = `h${lvl}` as "h2" | "h3" | "h4" | "h5";
      blocks.push(<Tag key={k}>{inline(h[2], k)}</Tag>);
      i++;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        if (/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i])) continue;   // separator row
        rows.push(tableCells(lines[i]));
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={k} className="rb-md-tablewrap">
          <table className="rb-md-table">
            <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `${k}h${j}`)}</th>)}</tr></thead>
            <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${k}r${ri}c${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      // a list, possibly nested by indentation (2 spaces per level)
      const items: { depth: number; ordered: boolean; text: string }[] = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]); i++) {
        const mm = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i])!;
        items.push({ depth: Math.floor(mm[1].length / 2), ordered: /\d/.test(mm[2]), text: mm[3] });
      }
      const build = (start: number, depth: number): [ReactNode, number] => {
        const ordered = items[start].ordered;
        const lis: ReactNode[] = [];
        let j = start;
        while (j < items.length && items[j].depth >= depth) {
          if (items[j].depth > depth) { const [sub, nj] = build(j, items[j].depth); lis.push(<Fragment key={`s${j}`}>{sub}</Fragment>); j = nj; continue; }
          const it = items[j];
          let child: ReactNode = null;
          let nj = j + 1;
          if (nj < items.length && items[nj].depth > depth) { const [sub, after] = build(nj, items[nj].depth); child = sub; nj = after; }
          lis.push(<li key={j}>{inline(it.text, `${k}l${j}`)}{child}</li>);
          j = nj;
        }
        return [ordered ? <ol key={`${k}o${start}`}>{lis}</ol> : <ul key={`${k}u${start}`}>{lis}</ul>, j];
      };
      blocks.push(<Fragment key={k}>{build(0, items[0].depth)[0]}</Fragment>);
      continue;
    }
    const para: string[] = [];
    for (; i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\||```|\s*([-*]|\d+\.)\s)/.test(lines[i]); i++) para.push(lines[i].trim());
    blocks.push(<p key={k}>{inline(para.join(" "), k)}</p>);
  }
  return <div className="rb-md">{blocks}</div>;
}

/* ---------- detail panel: what "Public" means for this benchmark ---------- */

// what each field is, and what it looks like in one downloaded row (one question answered by one model)
const FIELD_HELP: Record<string, { what: string; example: string }> = {
  Prompt: { what: "The question or task text that was given to the model.", example: "“Which planet has the most known moons?”" },
  Model: { what: "Which model gave this answer, so rows can be compared model by model.", example: "gpt-5.2" },
  Answer: { what: "The model’s full reply (for agent tasks: the whole step-by-step trajectory).", example: "“Saturn, with 274 known moons …”" },
  Score: { what: "How good this one answer was: right/wrong (1/0) or a grade from 0 to 1.", example: "1 (right)" },
  Cost: { what: "What this one answer cost in US dollars.", example: "$0.0042" },
  Tokens: { what: "How many tokens went in and came out for this answer (cost and speed follow from it).", example: "812 in / 356 out" },
  Effort: { what: "The reasoning-effort level (or thinking budget) the model ran with for this row.", example: "high" },
};
const STATUS_HELP: Record<PublicStatus, string> = {
  Yes: "downloadable for every question",
  Partial: "only partly public",
  No: "not public",
  "?": "the research files don’t say",
};
const LICENCE_HELP: Record<"open" | "none" | "mixed", string> = {
  open: "an open licence: you may reuse the data (keep the attribution it asks for)",
  mixed: "only part is openly licensed, or the licence is unverified: check before reusing",
  none: "no licence stated: by default you may read it, but reuse is not granted",
};

/** split a write-up right after its models section ("## Models…", else "## Single-model baselines…");
 *  without one, before "## For Yugos"; else at the end */
function splitAfterModels(md: string): [string, string] {
  const lines = md.split("\n");
  const heading = (re: RegExp) => lines.findIndex((l) => re.test(l));
  let at = heading(/^## Models\b/i);
  if (at < 0) at = heading(/^## Single-model baselines\b/i);
  if (at >= 0) {
    let end = lines.findIndex((l, i) => i > at && /^#{1,2} /.test(l));
    if (end < 0) end = lines.length;
    return [lines.slice(0, end).join("\n"), lines.slice(end).join("\n")];
  }
  const yugos = heading(/^## For Yugos\b/i);
  return yugos >= 0 ? [lines.slice(0, yugos).join("\n"), lines.slice(yugos).join("\n")] : [md, ""];
}

function PublicDetail({ b }: { b: RouterBenchmark }) {
  const pub = b.public;
  if (!pub) return null;
  const yes = PUBLIC_FIELDS.filter((f) => pub[f].status === "Yes");
  const missing = PUBLIC_FIELDS.filter((f) => pub[f].status !== "Yes");
  const has = (...fs: (typeof PUBLIC_FIELDS)[number][]) => fs.every((f) => pub[f].status === "Yes");
  // what the fully public fields are enough for, from the simplest use to the fullest
  const uses: string[] = [];
  if (has("Prompt", "Model", "Score")) uses.push("learn which model gets which kind of question right (the core of a router)");
  if (has("Prompt", "Model", "Score", "Cost") || has("Prompt", "Model", "Score", "Tokens")) uses.push("weigh quality against price per question");
  if (has("Answer")) uses.push("re-grade or inspect the answers yourself");
  if (has("Effort")) uses.push("compare effort levels of the same model");
  return (
    <section className="rb-md rb-pubd" aria-label="Public data per question">
      <h3>Public data per question</h3>
      <p>
        <strong>{yes.length} of {PUBLIC_FIELDS.length}</strong> fields are fully public per question
        {missing.length ? <> — not fully: {missing.join(", ")}.</> : "."}{" "}
        {uses.length
          ? <>With what is public you can {uses.join("; ")}.</>
          : <>That is not enough to learn routing per question (it needs at least Prompt, Model and Score).</>}
      </p>
      <table className="rb-pubd-table">
        <thead><tr><th>Field</th><th>In {b.name}</th><th>What it means</th><th>Example value in one row</th></tr></thead>
        <tbody>
          {PUBLIC_FIELDS.map((f) => {
            const { status, note } = pub[f];
            return (
              <tr key={f}>
                <th scope="row">{f}</th>
                <td>
                  <span className={`rb-tag s-${cls(status === "?" ? "unknown" : status)}`}>{STATUS_MARK[status]} {status === "?" ? "Unknown" : status}</span>
                  <span className="rb-pubd-note">{STATUS_HELP[status]}{note ? <> — <em>{note}</em></> : null}</span>
                </td>
                <td>{FIELD_HELP[f].what}</td>
                <td className="rb-pubd-ex">{FIELD_HELP[f].example}</td>
              </tr>
            );
          })}
          {b.licence && (
            <tr>
              <th scope="row">Licence</th>
              <td>
                <span className={`rb-tag lic-${licenceKind(b.licence)}`}>{b.licence}</span>
                <span className="rb-pubd-note">{LICENCE_HELP[licenceKind(b.licence)]}</span>
              </td>
              <td>The terms under which the data may be reused.</td>
              <td className="rb-pubd-ex">MIT, Apache-2.0, CC BY 4.0</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="subtle">
        Example: a router needs rows like <em>Prompt “Which planet has the most known moons?” · Model gpt-5.2 · Score 1 · Cost $0.0042 · Effort high</em>.
        If Score is only an average over the whole benchmark (Partial), you can see that a model is good overall, but not on which questions.
      </p>
    </section>
  );
}

/* ---------- the table ---------- */

export function RouterBenchmarksTable({ query, layout, benchmarks, groups, initialNotes = {}, initialArchived = [] }: {
  query: Query; layout?: SavedLayout; benchmarks: RouterBenchmark[]; groups: Record<string, string>;
  initialNotes?: Record<string, string>; initialArchived?: string[];
}) {
  // filters, sort and the open row start from the URL and are written back to it
  const [q, setQ] = useState(qOne(query, "q"));
  const [group, setGroup] = useState(qOne(query, "group"));
  const [useLv, setUseLv] = useState<string[]>(qMany(query, "use"));
  const [newLv, setNewLv] = useState<string[]>(qMany(query, "new"));
  const [pubF, setPubF] = useState<string[]>(qMany(query, "pub"));   // fields that must be fully public
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>(() => {
    const k = qOne(query, "sort") as SortKey;
    return { key: k in HEADS || k === "num" ? k : "num", dir: qOne(query, "dir") === "desc" ? -1 : 1 };
  });
  const [open, setOpen] = useState<number | null>(() => { const n = Number(qOne(query, "open")); return Number.isInteger(n) && n > 0 ? n : null; });
  const [closed, setClosed] = useState<string[]>(qMany(query, "closed"));   // collapsed groups (A–D)
  // the user's feedback: notes and archived benchmarks (saved on the server, keyed by benchmark name)
  const [notes, setNotes] = useState<Record<string, string>>(initialNotes);
  const [archived, setArchived] = useState<Set<string>>(() => new Set(initialArchived));
  const [showArch, setShowArch] = useState(() => qFlag(query, "archived"));   // also list archived benchmarks
  const [onlyNoted, setOnlyNoted] = useState(() => qFlag(query, "noted"));
  const [status, setStatus] = useState("");
  const [textToo, setTextToo] = useState(false);   // model search: also list benchmarks that only mention the name in text

  useQuerySync({
    q, group, use: useLv, new: newLv, pub: pubF,
    sort: sort.key === "num" ? "" : sort.key, dir: sort.dir === -1 ? "desc" : "",
    open: open ? String(open) : "", closed, archived: showArch, noted: onlyNoted,
  });

  const cl = useColumnLayout("router-benchmarks", COLS, layout);

  // search: when the words match model names in Model pool lists, only those benchmarks are found
  // (write-ups often say "No GPT-6 …", so plain text matching finds the wrong ones); else plain text
  const qTokens = useMemo(() => tokens(q), [q]);
  const poolHits = useMemo(() => {
    const m = new Map<number, string[]>();
    if (qTokens.length) for (const b of benchmarks) {
      const h = (b.pool?.models ?? []).filter((n) => modelMatches(qTokens, n) || (b.pool?.yugos?.[n] && modelMatches(qTokens, b.pool.yugos[n])));
      if (h.length) m.set(b.num, h);
    }
    return m;
  }, [benchmarks, qTokens]);
  const modelMode = poolHits.size > 0;

  const filtered = useMemo(() => {
    const rows = benchmarks.filter((b) => {
      if (group && b.group !== group) return false;
      if (useLv.length && !useLv.includes(b.yugos)) return false;
      if (newLv.length && !newLv.includes(b.newest)) return false;
      if (!showArch && archived.has(b.name)) return false;
      if (onlyNoted && !notes[b.name]) return false;
      if (pubF.length && !pubF.every((f) => b.public?.[f as keyof NonNullable<RouterBenchmark["public"]>]?.status === "Yes")) return false;
      if (qTokens.length && !poolHits.has(b.num)) {
        if (modelMode && !textToo) return false;
        const hay = normText([b.name, b.creators, b.scale, b.models, b.focus, b.finding, b.yugos_raw, b.newest_raw, b.licence ?? "", notes[b.name] ?? "", b.detail_md].join(" "));
        if (!textMatches(qTokens, hay)) return false;
      }
      return true;
    });
    const val = (b: RouterBenchmark): number | string =>
      sort.key === "num" ? b.num : sort.key === "name" ? b.name.toLowerCase()
        : sort.key === "newest" ? NEW_RANK[b.newest] : USE_RANK[b.yugos];
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : a.num - b.num) * sort.dir;
    });
  }, [benchmarks, qTokens, poolHits, modelMode, textToo, group, useLv, newLv, pubF, sort, showArch, archived, onlyNoted, notes]);

  // --- feedback: notes and archive (optimistic; rolled back if the server refuses) ---
  const post = async (body: object) => {
    const res = await fetch("/api/router-benchmarks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return res.ok ? null : ((await res.json().catch(() => ({}))).error ?? res.statusText);
  };
  const saveNote = async (name: string, note: string) => {
    const prev = notes[name] ?? "";
    if (note.trim() === prev) return;
    const put = (v: string) => setNotes((n) => { const c = { ...n }; if (v) c[name] = v; else delete c[name]; return c; });
    put(note.trim());
    const err = await post({ name, note });
    if (err) { put(prev); setStatus(`Note not saved: ${err}`); } else setStatus(`Note saved · ${name}`);
  };
  const setArchive = async (name: string, on: boolean) => {
    const flip = (v: boolean) => setArchived((a) => { const c = new Set(a); if (v) c.add(name); else c.delete(name); return c; });
    flip(on);
    if (on && open !== null && benchmarks.find((x) => x.num === open)?.name === name && !showArch) setOpen(null);
    const err = await post({ name, archived: on });
    if (err) { flip(!on); setStatus(`Not ${on ? "archived" : "unarchived"}: ${err}`); }
    else setStatus(on ? `Archived · ${name}${showArch ? "" : " (hidden; “Show archived” lists it)"}` : `Unarchived · ${name}`);
  };
  const archivedCount = benchmarks.filter((b) => archived.has(b.name)).length;
  const notedCount = benchmarks.filter((b) => notes[b.name]).length;

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const filtersOn = !!(q || group || useLv.length || newLv.length || pubF.length || onlyNoted);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of benchmarks) {
      c[`u:${b.yugos}`] = (c[`u:${b.yugos}`] ?? 0) + 1; c[`n:${b.newest}`] = (c[`n:${b.newest}`] ?? 0) + 1;
      for (const f of PUBLIC_FIELDS) if (b.public?.[f].status === "Yes") c[`p:${f}`] = (c[`p:${f}`] ?? 0) + 1;
    }
    return c;
  }, [benchmarks]);

  // filters live in the column headers (▾); active ones show as chips above the table
  const [pop, setPop] = useState<string | null>(null);
  const filterOn: Record<string, boolean> = { name: !!group || onlyNoted || showArch, yugos: useLv.length > 0, newest: newLv.length > 0, public: pubF.length > 0 };
  const popups: Record<string, () => ReactNode> = {
    name: () => (<>
      <p className="hf-title">Type</p>
      <label className="hf-opt"><input type="radio" name="rb-type" checked={!group} onChange={() => setGroup("")} /> All types<span className="hf-n">{benchmarks.length}</span></label>
      {Object.entries(groups).map(([g, label]) => (
        <label key={g} className="hf-opt"><input type="radio" name="rb-type" checked={group === g} onChange={() => setGroup(g)} /> {g} · {label}
          <span className="hf-n">{benchmarks.filter((b) => b.group === g).length}</span></label>))}
      <p className="hf-sub">Your feedback</p>
      <label className="hf-opt"><input type="checkbox" checked={onlyNoted} onChange={() => setOnlyNoted((v) => !v)} /> With notes<span className="hf-n">{notedCount}</span></label>
      <label className="hf-opt"><input type="checkbox" checked={showArch} onChange={() => setShowArch((v) => !v)} /> Show archived<span className="hf-n">{archivedCount}</span></label>
    </>),
    yugos: () => (<>
      <p className="hf-title">For Yugos</p>
      {USE_LEVELS.map((u) => (
        <label key={u} className="hf-opt"><input type="checkbox" checked={useLv.includes(u)} onChange={() => toggle(useLv, setUseLv, u)} /> {u}<span className="hf-n">{counts[`u:${u}`] ?? 0}</span></label>))}
    </>),
    newest: () => (<>
      <p className="hf-title">Newest models</p>
      {NEW_LEVELS.map((n) => (
        <label key={n} className="hf-opt"><input type="checkbox" checked={newLv.includes(n)} onChange={() => toggle(newLv, setNewLv, n)} /> {n}<span className="hf-n">{counts[`n:${n}`] ?? 0}</span></label>))}
    </>),
    public: () => (<>
      <p className="hf-title">Public per question (all of)</p>
      {PUBLIC_FIELDS.map((f) => (
        <label key={f} className="hf-opt"><input type="checkbox" checked={pubF.includes(f)} onChange={() => toggle(pubF, setPubF, f)} /> {f}<span className="hf-n">{counts[`p:${f}`] ?? 0}</span></label>))}
    </>),
  };
  const th = (key: string) => {
    const h = HEADS[key];
    const hp = cl.head(key);
    const sorted = !!h.sort && sort.key === h.sort;
    return (
      <th key={key} {...hp} title={h.title} className={`${hp.className}${sorted || filterOn[key] ? " col-on" : ""}`}
          aria-sort={sorted ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
        <span className="th-in">
          {h.sort ? (
            <button type="button" className="rb-sort col-sort" onClick={() => setSort((s) => ({ key: h.sort!, dir: s.key === h.sort ? (-s.dir as 1 | -1) : 1 }))}>
              {h.label}{sorted && <span className="col-arrow">{sort.dir === 1 ? "▲" : "▼"}</span>}
            </button>
          ) : <span>{h.label}</span>}
          {popups[key] && <FilterButton col={key} label={h.label} on={!!filterOn[key]} open={pop === key} onToggle={() => setPop((p) => (p === key ? null : key))} />}
        </span>
        {cl.grip(key)}
      </th>
    );
  };
  const chips: Chip[] = [];
  if (q) chips.push({ key: "q", label: `Search: “${q.trim()}”`, clear: () => setQ("") });
  if (group) chips.push({ key: "group", label: `Type: ${group} · ${groups[group] ?? ""}`, clear: () => setGroup(""), open: () => setPop("name") });
  if (useLv.length) chips.push({ key: "use", label: `For Yugos: ${useLv.join(", ")}`, clear: () => setUseLv([]), open: () => setPop("yugos") });
  if (newLv.length) chips.push({ key: "new", label: `Newest models: ${newLv.join(", ")}`, clear: () => setNewLv([]), open: () => setPop("newest") });
  if (pubF.length) chips.push({ key: "pub", label: `Public: ${pubF.join(" + ")}`, clear: () => setPubF([]), open: () => setPop("public") });
  if (onlyNoted) chips.push({ key: "noted", label: "With notes", clear: () => setOnlyNoted(false), open: () => setPop("name") });
  if (showArch) chips.push({ key: "arch", label: "Archived shown", clear: () => setShowArch(false), open: () => setPop("name") });
  const clearAll = () => { setQ(""); setGroup(""); setUseLv([]); setNewLv([]); setPubF([]); setOnlyNoted(false); setShowArch(false); };

  const cell = (b: RouterBenchmark, key: string): ReactNode => {
    switch (key) {
      case "num": return <td key={key} className="num">{b.num}</td>;
      case "name": return (
        <td key={key} className="rb-name" data-tip>
          <span className="rb-caret" aria-hidden="true">{open === b.num ? "▾" : "▸"}</span> {b.name}
          {archived.has(b.name) && <span className="rb-archived-tag">archived</span>}
        </td>
      );
      case "note": return (
        <td key={key} className="rb-notecell" data-tip><NoteCell cls="rb" value={notes[b.name] ?? ""} onSave={(v) => saveNote(b.name, v)} label={b.name} /></td>
      );
      case "newest": return <td key={key}><span className={`rb-badge n-${cls(b.newest)}`} title={b.newest_raw}>{b.newest}</span></td>;
      case "yugos": return <td key={key}><span className={`rb-badge u-${cls(b.yugos)}`} title={b.yugos_raw}>{b.yugos}</span></td>;
      case "public": return <td key={key} className="rb-public" data-tip><PublicTags b={b} /></td>;
      case "models": return (
        <td key={key} className="rb-models" data-tip={b.pool?.models.length ? "always" : ""}>
          <ModelTags b={b} hits={poolHits.get(b.num)} />
        </td>
      );
      default: {
        const v = (b as unknown as Record<string, string>)[key] ?? "";
        return <td key={key} className="rb-clip" data-tip>{v || "—"}</td>;
      }
    }
  };

  const colCount = cl.cols.length;
  const openB = open === null ? null : benchmarks.find((b) => b.num === open) ?? null;
  // groups show as headings (and can be collapsed) in the default order: by #, ascending
  const grouped = sort.key === "num" && sort.dir === 1;
  const groupCount: Record<string, number> = {};
  for (const b of filtered) groupCount[b.group] = (groupCount[b.group] ?? 0) + 1;
  const shownGroups = Object.keys(groupCount);
  const flipGroup = (g: string) => setClosed((c) => (c.includes(g) ? c.filter((x) => x !== g) : [...c, g].sort()));
  const firstGroup = filtered[0]?.group;
  let lastGroup = "";
  let band = -1;

  return (
    <div className="rb">
      <div className="rb-filters">
        <input type="search" className="rb-search" placeholder="Search name, models, finding, full write-up…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search router benchmarks" />
        <span className="bl-total"><b>{filtered.length}</b> of {benchmarks.length} benchmarks{!showArch && archivedCount ? <span className="muted"> · {archivedCount} archived</span> : null}</span>
        {status && <span className="muted small" role="status">{status}</span>}
        <span className="bl-viewopts">
          {grouped && shownGroups.length > 1 && <>
            <button type="button" className="link" disabled={!closed.length} onClick={() => setClosed([])}>Expand all</button>
            <button type="button" className="link" disabled={shownGroups.every((g) => closed.includes(g))} onClick={() => setClosed(Object.keys(groups).sort())}>Collapse all</button>
          </>}
          <ColumnsMenu layout={cl} labels={Object.fromEntries(Object.entries(HEADS).map(([k, h]) => [k, h.label]))} />
          <DensityToggle />
        </span>
      </div>
      <FilterChips chips={chips} onClearAll={clearAll} />
      {pop && popups[pop] && <FilterPop anchor={pop} onClose={() => setPop(null)}>{popups[pop]()}</FilterPop>}

      {modelMode && (
        <p className="small rb-searchnote">
          “{q.trim()}” matches models in the Model pool of <strong>{poolHits.size}</strong> benchmark{poolHits.size === 1 ? "" : "s"} (highlighted).{" "}
          <button type="button" className="link" onClick={() => setTextToo((v) => !v)}>
            {textToo ? "Hide benchmarks that only mention it in their text" : "Also show benchmarks that only mention it in their text"}
          </button>
        </p>
      )}
      <div className={`rb-body${openB ? " with-panel" : ""}`}>
      <HoverTip className="rb-tablebox">
      <div className="rb-scroll" ref={cl.root}>
        <table className="grid rb-table cl" style={{ width: cl.total }}>
          <colgroup>{cl.cols.map((c) => <col key={c.key} style={{ width: cl.width(c.key) }} />)}</colgroup>
          <thead><tr>{cl.cols.map((c) => th(c.key))}</tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={colCount} className="rb-none">No benchmarks match.</td></tr>}
            {filtered.map((b) => {
              const showGroup = grouped && b.group !== lastGroup;
              const isClosed = grouped && closed.includes(b.group);
              lastGroup = b.group;
              const isOpen = open === b.num;
              band = showGroup ? 0 : band + 1;          // odd/even rows, counted afresh in each group
              const zb = band % 2 ? " zb" : "";
              return (
                <Fragment key={b.num}>
                  {showGroup && b.group !== firstGroup && <tr className="rb-gap" aria-hidden="true"><td colSpan={colCount} /></tr>}
                  {showGroup && (
                    <tr className="rb-grouprow">
                      <td colSpan={colCount}>
                        <button type="button" className="rb-group-toggle" aria-expanded={!isClosed} onClick={() => flipGroup(b.group)}>
                          <span className="rb-caret" aria-hidden="true">{isClosed ? "▸" : "▾"}</span>
                          <strong>{b.group} · {b.group_label}</strong>
                          <span className="subtle">· {groupCount[b.group]} benchmark{groupCount[b.group] === 1 ? "" : "s"}</span>
                        </button>
                      </td>
                    </tr>
                  )}
                  {!isClosed && <>
                  <tr className={`rb-row${isOpen ? " open" : ""}${zb}${archived.has(b.name) ? " rb-is-archived" : ""}`} tabIndex={0} aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : b.num)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : b.num); } }}>
                    {cl.cols.map((c) => cell(b, c.key))}
                  </tr>
                  </>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      </HoverTip>
      {openB && (
        <article className="rb-panel" aria-label={`Write-up: ${openB.name}`}>
          <div className="rb-panel-head">
            <div>
              <p className="muted small rb-detail-links">
                Router benchmark {openB.num} · {openB.group} · {openB.group_label}
                {openB.links.map((l, j) => <a key={j} href={l.url} target="_blank" rel="noreferrer">{l.label}</a>)}
              </p>
              <h2>{openB.name}</h2>
            </div>
            <span className="row">
              <button type="button" className="button" onClick={() => setArchive(openB.name, !archived.has(openB.name))}
                      title={archived.has(openB.name) ? "Put it back in the list" : "Hide it from the list (kept; “Show archived” lists it again)"}>
                {archived.has(openB.name) ? "Unarchive" : "Archive"}
              </button>
              <button type="button" className="rb-panel-x" aria-label="Close the write-up" onClick={() => setOpen(null)}>×</button>
            </span>
          </div>
          <p className="row">
            <span className={`rb-badge u-${cls(openB.yugos)}`} title={openB.yugos_raw}>For Yugos: {openB.yugos}</span>
            <span className={`rb-badge n-${cls(openB.newest)}`} title={openB.newest_raw}>Newest models: {openB.newest}</span>
          </p>
          <div className="rb-panel-note"><span className="bl-field-label">My feedback</span>
            <NoteCell cls="rb" value={notes[openB.name] ?? ""} onSave={(v) => saveNote(openB.name, v)} label={openB.name} />
          </div>
          <div className="rb-detail-inner">
            {openB.detail_md ? (() => {
              // the Public section goes right after the write-up's models section
              const [before, after] = splitAfterModels(openB.detail_md);
              return <>{<Markdown text={before} />}<PublicDetail b={openB} />{after && <Markdown text={after} />}</>;
            })() : <><PublicDetail b={openB} /><p className="subtle">No write-up for this benchmark yet.</p></>}
          </div>
          <p className="muted small">Source: {openB.file ?? "no write-up file"}</p>
        </article>
      )}
      </div>
    </div>
  );
}
