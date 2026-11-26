"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface Option {
  value: string;
  label: string;
  hint?: string;     // secondary text, also searched
  title?: string;    // full description, shown on hover
  group?: string;    // options with a group are listed under a heading (also searched)
  groupValue?: string;  // group-selection mode: the value reported when the whole group is chosen
  short?: string;       // name used in the closed box when it lists every choice (listAll)
}

/** groups larger than this start collapsed (until a search finds something in them) */
const COLLAPSE_OVER = 30;

/** checkbox that can show the "some selected" state */
function GroupCheckbox({ state, onChange, label }: { state: "all" | "some" | "none"; onChange: () => void; label: string }) {
  return (
    <input type="checkbox" aria-label={label} checked={state === "all"} onChange={onChange}
           ref={(el) => { if (el) el.indeterminate = state === "some"; }} />
  );
}

/**
 * Dropdown with a search box and checkboxes. Selecting nothing means "all".
 * Every change calls onChange right away; the panel stays open for more picks.
 * Options that carry a group are shown under collapsible group headings.
 *
 * Group-selection mode (pass `selectedGroups`): a heading's checkbox chooses the group
 * itself (reported in `groups`, e.g. a whole source), and items can still be chosen one
 * by one (reported in `values`). A chosen group shows all its items as ticked.
 */
export function MultiSelect({ id, label, allLabel, options, selected, selectedGroups, onChange, listAll }: {
  id: string;
  label: string;
  allLabel: string;
  options: Option[];
  selected: string[];
  selectedGroups?: string[];
  onChange: (values: string[], groups: string[]) => void;
  listAll?: boolean;   // the closed box names every choice ("1 Basic, 5 Unsolved"), not "2 selected"
}) {
  const groupMode = selectedGroups !== undefined;
  const chosenGroups = useMemo(() => new Set(selectedGroups ?? []), [selectedGroups]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [alignRight, setAlignRight] = useState(false);   // open leftwards near the window's right edge
  const [manual, setManual] = useState<Map<string, boolean>>(new Map());  // groups the user opened/closed
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();

  // close on outside click and Escape; a reopened panel starts with an empty search
  useEffect(() => {
    if (!open) { setQuery(""); setManual(new Map()); return; }
    const box = root.current?.getBoundingClientRect();
    setAlignRight(!!box && box.left + 340 > window.innerWidth - 12);
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); root.current?.querySelector("button")?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    search.current?.focus();
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const chosen = useMemo(() => new Set(selected), [selected]);
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => `${o.label} ${o.hint ?? ""} ${o.group ?? ""}`.toLowerCase().includes(q)) : options;
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);

  const groupName = useMemo(() => new Map(options.filter((o) => o.groupValue).map((o) => [o.groupValue!, o.group ?? ""])), [options]);
  const groupsNow = selectedGroups ?? [];
  const names = [...groupsNow.map((g) => groupName.get(g) ?? g), ...selected.map((v) => byValue.get(v)?.label ?? v)];
  const summary = names.length === 0 ? allLabel
    : listAll ? options.filter((o) => chosen.has(o.value)).map((o) => o.short ?? o.label).join(", ")
    : names.length === 1 ? names[0] : `${names.length} selected`;

  const emit = (values: string[], groups: string[] = groupsNow) => onChange(values, groups);
  const groupOn = (o: Option) => !!o.groupValue && chosenGroups.has(o.groupValue);
  const toggle = (o: Option) => {
    if (groupOn(o)) {
      // unticking one item of a chosen group: keep the group's other items instead
      const rest = options.filter((x) => x.groupValue === o.groupValue && x.value !== o.value).map((x) => x.value);
      emit([...new Set([...selected, ...rest])], groupsNow.filter((g) => g !== o.groupValue));
    } else {
      emit(chosen.has(o.value) ? selected.filter((x) => x !== o.value) : [...selected, o.value]);
    }
  };
  const selectShown = () => emit([...new Set([...selected, ...shown.filter((o) => !groupOn(o)).map((o) => o.value)])]);

  // grouped view: headings in first-seen order
  const grouped = options.some((o) => o.group);
  const groups = useMemo(() => {
    const m = new Map<string, Option[]>();
    for (const o of shown) m.set(o.group ?? "Other", [...(m.get(o.group ?? "Other") ?? []), o]);
    return [...m.entries()];
  }, [shown]);
  const totalIn = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of options) m.set(o.group ?? "Other", (m.get(o.group ?? "Other") ?? 0) + 1);
    return m;
  }, [options]);
  // while searching every group with matches is open; otherwise the user's choice, else open unless large
  const isExpanded = (g: string) => q !== "" || (manual.get(g) ?? (totalIn.get(g) ?? 0) <= COLLAPSE_OVER);
  const flip = (g: string) => setManual((m) => new Map(m).set(g, !isExpanded(g)));
  const allGroups = [...totalIn.keys()];
  const setAll = (open: boolean) => setManual(new Map(allGroups.map((g) => [g, open])));
  const allOpen = allGroups.every(isExpanded);
  const allClosed = allGroups.every((g) => !isExpanded(g));
  const groupState = (items: Option[]) => {
    if (groupMode && items[0]?.groupValue && chosenGroups.has(items[0].groupValue)) return "all";
    const n = items.filter((o) => chosen.has(o.value)).length;
    return n === 0 ? "none" : n === items.length && !groupMode ? "all" : "some";
  };
  const toggleGroup = (items: Option[]) => {
    const gv = items[0]?.groupValue;
    if (groupMode && gv) {
      // the group itself is the choice; its individually ticked items are folded into it
      const inGroup = new Set(options.filter((o) => o.groupValue === gv).map((o) => o.value));
      if (chosenGroups.has(gv)) emit(selected, groupsNow.filter((g) => g !== gv));
      else emit(selected.filter((v) => !inGroup.has(v)), [...groupsNow, gv]);
      return;
    }
    const values = new Set(items.map((o) => o.value));
    emit(groupState(items) === "all" ? selected.filter((v) => !values.has(v)) : [...new Set([...selected, ...values])]);
  };

  const optionRow = (o: Option) => (
    <li key={o.value} role="option" aria-selected={chosen.has(o.value) || groupOn(o)}>
      <label className="multi-option" title={o.title ?? (o.hint ? `${o.label} · ${o.hint}` : undefined)}>
        <input type="checkbox" checked={chosen.has(o.value) || groupOn(o)} onChange={() => toggle(o)} />
        <span className="multi-label">{o.label}</span>
        {o.hint && <span className="multi-hint">{o.hint}</span>}
      </label>
    </li>
  );

  return (
    <div className="field multi" ref={root}>
      <label htmlFor={id}>{label}</label>
      <button id={id} type="button" className={`multi-trigger${names.length ? " active" : ""}`}
              aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
              onClick={() => setOpen((o) => !o)} title={names.join(", ")}>
        <span className="multi-summary">{summary}</span>
        <span aria-hidden="true" className="multi-caret">▾</span>
      </button>
      {open && (
        <div className={`multi-panel${alignRight ? " align-right" : ""}`} role="dialog" aria-label={`${label} filter`}>
          {options.length > 12 && (
            <input ref={search} type="search" className="multi-search" placeholder={`Search ${label.toLowerCase()}…`}
                   value={query} onChange={(e) => setQuery(e.target.value)} aria-label={`Search ${label.toLowerCase()}`} />
          )}
          {grouped && !q && allGroups.length > 1 && (
            <div className="multi-actions small multi-expand">
              <span className="muted">{allGroups.length} groups</span>
              <span className="row">
                <button type="button" className="link" onClick={() => setAll(true)} disabled={allOpen}>Expand all</button>
                <button type="button" className="link" onClick={() => setAll(false)} disabled={allClosed}>Collapse all</button>
              </span>
            </div>
          )}
          <div className="multi-actions small">
            <span className="muted">{names.length ? `${names.length} selected` : allLabel}</span>
            <span className="row">
              {q && shown.length > 0 && <button type="button" className="link" onClick={selectShown}>Select shown ({shown.length})</button>}
              {names.length > 0 && <button type="button" className="link" onClick={() => onChange([], [])}>Clear</button>}
            </span>
          </div>
          <ul id={listId} className="multi-list" role="listbox" aria-multiselectable="true">
            {shown.length === 0 && <li className="muted small multi-empty">No matches</li>}
            {!grouped && shown.map(optionRow)}
            {grouped && groups.map(([g, items]) => {
              const expanded = isExpanded(g);
              const whole = groupMode && !!items[0]?.groupValue && chosenGroups.has(items[0].groupValue);
              const picked = whole ? items.length : items.filter((o) => chosen.has(o.value)).length;
              return (
                <li key={g} className="multi-group" role="presentation">
                  <div className="multi-group-head">
                    <GroupCheckbox state={groupState(items)} onChange={() => toggleGroup(items)}
                                   label={groupMode ? `Select all of ${g}` : `Select all ${q ? "matching " : ""}in ${g}`} />
                    <button type="button" className="multi-group-toggle" aria-expanded={expanded} onClick={() => flip(g)}
                            disabled={q !== ""} title={q ? "Groups with matches stay open while searching" : undefined}>
                      <span className="multi-group-name">{g}</span>
                      <span className="multi-hint">
                        {whole ? "all " : picked ? `${picked} of ` : ""}{items.length}{q && items.length !== totalIn.get(g) ? ` of ${totalIn.get(g)}` : ""}
                      </span>
                      <span aria-hidden="true" className="multi-caret">{expanded ? "▾" : "▸"}</span>
                    </button>
                  </div>
                  {expanded && <ul className="multi-sublist" role="group" aria-label={g}>{items.map(optionRow)}</ul>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
