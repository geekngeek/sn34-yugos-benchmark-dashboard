// Yugos match: the compact cell (three bars), the level-mix bar and the full breakdown for a details panel.
import { Fragment } from "react";
import { CAT_LABEL, CAT_SHORT, FACTOR_INFO, LEVEL_SHORT, MATCH_CATS, pct, type MatchCat, type MatchInfo, type MatchTargets, type MatchTriple } from "@/lib/yugosMatch";

const PART_WORD = { public: "public", private: "private" } as const;

/** three thin bars (chat · math & code · agentic); the best one is labelled with its % */
export function MatchBars({ t, best, title, faint, overlap }: { t: MatchTriple | null | undefined; best?: MatchCat; title?: string; faint?: boolean; overlap?: boolean }) {
  if (!t) return <span className="mx-none muted" title="Not assessed">—</span>;
  const top = best ?? MATCH_CATS.reduce((a, c) => (t[c] > t[a] ? c : a), "chat" as MatchCat);
  const tip = title ?? MATCH_CATS.map((c) => `${CAT_LABEL[c]}: ${pct(t[c])}`).join(" · ");
  return (
    <span className={`mx-bars${faint ? " faint" : ""}`} title={tip} aria-label={tip}>
      {MATCH_CATS.map((c) => (
        <span key={c} className={`mx-bar mx-${c}${c === top ? " top" : ""}`}>
          <span className="mx-track"><span className="mx-fill" style={{ width: `${Math.max(2, Math.round(t[c] * 100))}%` }} /></span>
        </span>
      ))}
      <span className={`mx-val mx-${top}`}>{CAT_SHORT[top]} {Math.round(t[top] * 100)}</span>
      {overlap && <span className="mx-ov" title="Shares questions with a live Yugos set: remove those before use, never test on them">◆</span>}
    </span>
  );
}

/** L1..L5 shares as one stacked bar (light = easy, dark = hard) */
export function LevelBar({ levels, label, small }: { levels: number[] | null | undefined; label?: string; small?: boolean }) {
  if (!levels) return <span className="muted small">no difficulty data</span>;
  const tip = levels.map((v, i) => `${LEVEL_SHORT[i]} ${Math.round(v * 100)}%`).join(" · ");
  return (
    <span className={`lv-wrap${small ? " small" : ""}`} title={label ? `${label}: ${tip}` : tip}>
      {label && <span className="lv-label">{label}</span>}
      <span className="lv-bar" aria-label={tip}>
        {levels.map((v, i) => v > 0.004 && <span key={i} className={`lv-seg lv-${i + 1}`} style={{ flexGrow: v }} />)}
      </span>
    </span>
  );
}

export function LevelKey() {
  return (
    <span className="lv-key small muted">
      {LEVEL_SHORT.map((l, i) => <span key={l}><span className={`lv-sw lv-${i + 1}`} />{l}</span>)}
    </span>
  );
}

const yesWord = (v?: string | null) => (v === "yes" ? "Yes" : v === "partial" ? "Partly" : v === "no" ? "No" : "Unknown");
const isUrl = (s?: string | null) => !!s && /^https?:\/\//.test(s);
const linkOrText = (s?: string | null) => (isUrl(s) ? <a href={s!} target="_blank" rel="noreferrer">{s!.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)} ↗</a> : s);

/** the full breakdown: per category the score, which Yugos part, each factor with the reason, then the facts */
export function MatchDetail({ m, targets }: { m: MatchInfo; targets: MatchTargets | null }) {
  const order = [...MATCH_CATS].sort((a, b) => m.match[b].match - m.match[a].match);
  const bestCat = order[0];
  const tgt = targets?.[bestCat]?.parts[m.match[bestCat].part];
  return (
    <div className="mx-detail">
      {m.overlap && <p className="mx-overlap small"><b>Overlap with a live Yugos set:</b> {m.overlap}</p>}
      {m.summary && <p className="small">{m.summary}</p>}
      <div className="mx-cats">
        {order.map((c) => {
          const s = m.match[c];
          const strong = s.T > 0.15;
          return (
            <div key={c} className={`mx-cat${strong ? "" : " weak"}`}>
              <div className="mx-cat-head">
                <span className={`mx-dot mx-${c}`} aria-hidden="true" />
                <b>{CAT_LABEL[c]}</b>
                <span className="mx-cat-pct">{pct(s.match)}</span>
                {strong && <span className="muted small">stands in for the {PART_WORD[s.part]} part{s.part === "private" ? " (hidden)" : ""}</span>}
              </div>
              {strong ? (
                <>
                  <div className="mx-factors">
                    {FACTOR_INFO.map((f) => {
                      const v = f.key === "D" ? s.D : s[f.key];
                      return (
                        <Fragment key={f.key}>
                          <span className="mx-f-name" title={f.help}>{f.label} <span className="muted">{f.weight}</span></span>
                          <span className="mx-f-bar"><span style={{ width: `${Math.round((v ?? 0.5) * 100)}%` }} className={v === null ? "none" : ""} /></span>
                          <span className="mx-f-val num">{v === null ? "n/a" : v.toFixed(2)}</span>
                        </Fragment>
                      );
                    })}
                  </div>
                  <p className="small subtle">{s.why}</p>
                </>
              ) : <p className="small muted">{s.why || "Different skill."}</p>}
            </div>
          );
        })}
      </div>
      <div className="mx-levels">
        <b className="small">Difficulty</b> <LevelKey />
        <LevelBar levels={m.levels} label="This" />
        {tgt && <LevelBar levels={tgt.levels} label={`Yugos ${CAT_SHORT[bestCat]}, ${PART_WORD[m.match[bestCat].part]}`} />}
        <p className="small muted">Level mix from: {m.level_source}{m.level_note ? ` — ${m.level_note}` : ""}</p>
      </div>
      {!!m.adjusted?.length && (
        <details className="small"><summary>Adjusted by hand ({m.adjusted.length})</summary>
          <ul className="mx-src">{m.adjusted.map((a) => <li key={a}>{a}</li>)}</ul>
        </details>
      )}
      <dl className="mx-facts small">
        <dt>Questions downloadable</dt><dd>{yesWord(m.questions_public)}{m.questions_where ? <> · {linkOrText(m.questions_where)}</> : null}</dd>
        {m.n_questions != null && <><dt>Questions</dt><dd>{m.n_questions.toLocaleString("en-US")}</dd></>}
        <dt>Per-question model results</dt><dd>{yesWord(m.per_question_results)}{m.results_where ? <> · {linkOrText(m.results_where)}</> : null}</dd>
        {m.modality && <><dt>Modality</dt><dd>{m.modality}</dd></>}
        {m.licence && <><dt>Licence</dt><dd>{m.licence}</dd></>}
        {m.confidence && <><dt>Confidence</dt><dd>{m.confidence}</dd></>}
      </dl>
      {!!m.sources?.length && (
        <details className="small"><summary>Sources ({m.sources.length})</summary>
          <ul className="mx-src">{m.sources.map((s) => <li key={s}>{linkOrText(s)}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
