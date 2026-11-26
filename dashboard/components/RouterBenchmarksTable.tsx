"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import type { Freshness, RouterBenchmark, Usefulness } from "@/lib/routerBenchmarks";
import { ResetColumns, useColumnLayout, type ColDef, type SavedLayout } from "@/lib/columnLayout";
import { qMany, qOne, useQuerySync, type Query } from "@/lib/urlState";

type SortKey = "num" | "name" | "group" | "newest" | "yugos";

const USE_RANK: Record<Usefulness, number> = { High: 0, Medium: 1, "Low–Medium": 2, Low: 3, No: 4, "?": 5 };
const NEW_RANK: Record<Freshness, number> = { Yes: 0, Partly: 1, Unknown: 2, No: 3 };
const USE_LEVELS: Usefulness[] = ["High", "Medium", "Low–Medium", "Low", "No"];
const NEW_LEVELS: Freshness[] = ["Yes", "Partly", "Unknown", "No"];

// columns in their default order and width (px); the user can drag and resize them (saved on the server)
const COLS: ColDef[] = [
  { key: "num", width: 46, min: 40, fixed: true }, { key: "name", width: 220, min: 120 }, { key: "group", width: 150, min: 90 },
  { key: "creators", width: 190, min: 90 }, { key: "scale", width: 300, min: 120 }, { key: "models", width: 260, min: 100 },
  { key: "focus", width: 220, min: 100 }, { key: "newest", width: 92, min: 70, fixed: true }, { key: "yugos", width: 110, min: 80, fixed: true },
  { key: "finding", width: 320, min: 120 }, { key: "link", width: 150, min: 70 },
];
const HEADS: Record<string, { label: string; sort?: SortKey; title?: string }> = {
  num: { label: "#", sort: "num" }, name: { label: "Benchmark", sort: "name" }, group: { label: "Type", sort: "group" },
  creators: { label: "Creators / year" }, scale: { label: "Scale" }, models: { label: "Model pool" }, focus: { label: "Focus / stored data" },
  newest: { label: "Newest models", sort: "newest", title: "Has GPT-6 / Claude 5.x / Gemini 4 / DeepSeek V4-era models" },
  yugos: { label: "For Yugos", sort: "yugos", title: "How useful for building the Yugos router" },
  finding: { label: "Key finding" }, link: { label: "Link" },
};

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

/* ---------- the table ---------- */

export function RouterBenchmarksTable({ query, layout, benchmarks, groups }: {
  query: Query; layout?: SavedLayout; benchmarks: RouterBenchmark[]; groups: Record<string, string>;
}) {
  // filters, sort and the open row start from the URL and are written back to it
  const [q, setQ] = useState(qOne(query, "q"));
  const [group, setGroup] = useState(qOne(query, "group"));
  const [useLv, setUseLv] = useState<string[]>(qMany(query, "use"));
  const [newLv, setNewLv] = useState<string[]>(qMany(query, "new"));
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>(() => {
    const k = qOne(query, "sort") as SortKey;
    return { key: k in HEADS || k === "num" ? k : "num", dir: qOne(query, "dir") === "desc" ? -1 : 1 };
  });
  const [open, setOpen] = useState<number | null>(() => { const n = Number(qOne(query, "open")); return Number.isInteger(n) && n > 0 ? n : null; });

  useQuerySync({
    q, group, use: useLv, new: newLv,
    sort: sort.key === "num" ? "" : sort.key, dir: sort.dir === -1 ? "desc" : "",
    open: open ? String(open) : "",
  });

  const cl = useColumnLayout("router-benchmarks", COLS, layout);

  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = benchmarks.filter((b) => {
      if (group && b.group !== group) return false;
      if (useLv.length && !useLv.includes(b.yugos)) return false;
      if (newLv.length && !newLv.includes(b.newest)) return false;
      if (words.length) {
        const hay = [b.name, b.creators, b.scale, b.models, b.focus, b.finding, b.yugos_raw, b.newest_raw, b.detail_md].join(" ").toLowerCase();
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    const val = (b: RouterBenchmark): number | string =>
      sort.key === "num" ? b.num : sort.key === "name" ? b.name.toLowerCase() : sort.key === "group" ? b.group
        : sort.key === "newest" ? NEW_RANK[b.newest] : USE_RANK[b.yugos];
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : a.num - b.num) * sort.dir;
    });
  }, [benchmarks, q, group, useLv, newLv, sort]);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const filtersOn = !!(q || group || useLv.length || newLv.length);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of benchmarks) { c[`u:${b.yugos}`] = (c[`u:${b.yugos}`] ?? 0) + 1; c[`n:${b.newest}`] = (c[`n:${b.newest}`] ?? 0) + 1; }
    return c;
  }, [benchmarks]);

  const th = (key: string) => {
    const h = HEADS[key];
    const hp = cl.head(key);
    return (
      <th key={key} {...hp} title={h.title} aria-sort={h.sort && sort.key === h.sort ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
        {h.sort ? (
          <button type="button" className="rb-sort" onClick={() => setSort((s) => ({ key: h.sort!, dir: s.key === h.sort ? (-s.dir as 1 | -1) : 1 }))}>
            {h.label}{sort.key === h.sort ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
          </button>
        ) : h.label}
        {cl.grip(key)}
      </th>
    );
  };

  const cell = (b: RouterBenchmark, key: string): ReactNode => {
    switch (key) {
      case "num": return <td key={key} className="num">{b.num}</td>;
      case "name": return (
        <td key={key} className="rb-name">
          <span className="rb-caret" aria-hidden="true">{open === b.num ? "▾" : "▸"}</span> {b.name}
        </td>
      );
      case "group": return <td key={key}><span className={`rb-type t-${b.group}`} title={b.group_label}>{b.group} · {b.group_label}</span></td>;
      case "newest": return <td key={key}><span className={`rb-badge n-${cls(b.newest)}`} title={b.newest_raw}>{b.newest}</span></td>;
      case "yugos": return <td key={key}><span className={`rb-badge u-${cls(b.yugos)}`} title={b.yugos_raw}>{b.yugos}</span></td>;
      case "link": return (
        <td key={key} className="rb-links" onClick={(e) => e.stopPropagation()}>
          {b.links.length ? b.links.map((l, j) => <a key={j} href={l.url} target="_blank" rel="noreferrer">{l.label}</a>) : <span className="subtle">{b.link_text || "—"}</span>}
        </td>
      );
      default: {
        const v = (b as unknown as Record<string, string>)[key] ?? "";
        return <td key={key} className="rb-clip" title={v}>{v || "—"}</td>;
      }
    }
  };

  const colCount = cl.cols.length;
  let lastGroup = "";

  return (
    <div className="rb">
      <div className="rb-bar">
        <div className="rb-count">
          <span><strong>{filtered.length}</strong> of {benchmarks.length} benchmarks</span>
          {filtersOn && (
            <button type="button" className="link" onClick={() => { setQ(""); setGroup(""); setUseLv([]); setNewLv([]); }}>Clear filters</button>
          )}
        </div>
        <ResetColumns layout={cl} />
      </div>

      <div className="rb-filters">
        <input type="search" className="rb-search" placeholder="Search name, models, finding, full write-up…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {Object.entries(groups).map(([g, label]) => <option key={g} value={g}>{g} · {label}</option>)}
        </select>
        <span className="rb-group" role="group" aria-label="Useful for Yugos">
          For Yugos:
          {USE_LEVELS.map((u) => (
            <button key={u} type="button" className={`rb-chip${useLv.includes(u) ? " on" : ""}`} aria-pressed={useLv.includes(u)} onClick={() => toggle(useLv, setUseLv, u)}>
              {u} <span className="rb-n">{counts[`u:${u}`] ?? 0}</span>
            </button>
          ))}
        </span>
        <span className="rb-group" role="group" aria-label="Has newest models">
          Newest models:
          {NEW_LEVELS.map((n) => (
            <button key={n} type="button" className={`rb-chip${newLv.includes(n) ? " on" : ""}`} aria-pressed={newLv.includes(n)} onClick={() => toggle(newLv, setNewLv, n)}>
              {n} <span className="rb-n">{counts[`n:${n}`] ?? 0}</span>
            </button>
          ))}
        </span>
      </div>

      <div className="rb-scroll" ref={cl.root}>
        <table className="grid rb-table cl" style={{ width: cl.total }}>
          <colgroup>{cl.cols.map((c) => <col key={c.key} style={{ width: cl.width(c.key) }} />)}</colgroup>
          <thead><tr>{cl.cols.map((c) => th(c.key))}</tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={colCount} className="rb-none">No benchmarks match.</td></tr>}
            {filtered.map((b) => {
              const showGroup = sort.key === "num" && sort.dir === 1 && b.group !== lastGroup;
              lastGroup = b.group;
              const isOpen = open === b.num;
              return (
                <Fragment key={b.num}>
                  {showGroup && (
                    <tr className="rb-grouprow"><td colSpan={colCount}>{b.group} · {b.group_label}</td></tr>
                  )}
                  <tr className={`rb-row${isOpen ? " open" : ""}`} tabIndex={0} aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : b.num)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : b.num); } }}>
                    {cl.cols.map((c) => cell(b, c.key))}
                  </tr>
                  {isOpen && (
                    <tr className="rb-detail">
                      <td colSpan={colCount}>
                        <div className="rb-detail-inner">
                          <div className="rb-detail-head">
                            <span className="subtle small">Source: {b.file ?? "no write-up file"}</span>
                            <button type="button" className="link" onClick={() => setOpen(null)}>Close</button>
                          </div>
                          {b.detail_md ? <Markdown text={b.detail_md} /> : <p className="subtle">No write-up for this benchmark yet.</p>}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
