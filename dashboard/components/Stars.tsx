import { difficultyText, type Difficulty } from "@/lib/difficulty";

/** Five stars: solid up to the level that is certain, dim for levels it may also be, empty beyond. */
export function Stars({ d, span = false }: { d: Difficulty; span?: boolean }) {
  if (d.kind === "na") return <span className="stars-na" aria-label="Cannot be levelled">—</span>;
  if (d.kind === "none") return null;
  const label = difficultyText(d);
  return (
    <span className={`stars${span ? " span" : ""}`} role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((i) => {
        const cls = span ? (i >= d.lo && i <= d.hi ? "on" : "off") : i <= d.lo ? "on" : i <= d.hi ? "maybe" : "off";
        return <span key={i} className={`star ${cls}`}>★</span>;
      })}
      {d.lo !== d.hi && <span className="stars-txt">{d.lo}–{d.hi}</span>}
    </span>
  );
}
