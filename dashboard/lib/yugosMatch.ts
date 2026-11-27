// Yugos match scores (data/yugos-match/*.json, built by scripts/build_yugos_match.py; method in docs/yugos-match.md):
// how well a sub-benchmark's or a public dataset's questions can stand in for Yugos's chat, math & code and agentic
// questions. Types and labels only: safe for client components.

export type MatchCat = "chat" | "math_code" | "agentic";
export type MatchPart = "public" | "private";
export const MATCH_CATS: MatchCat[] = ["chat", "math_code", "agentic"];
export const CAT_LABEL: Record<MatchCat, string> = { chat: "Chat & QA", math_code: "Math & code", agentic: "Agentic" };
export const CAT_SHORT: Record<MatchCat, string> = { chat: "Chat", math_code: "Math", agentic: "Agent" };

export interface CatMatch {
  match: number;                 // 0..1: T x weighted mean of the other factors and the difficulty fit
  part: MatchPart;               // the Yugos part it stands in for best
  D: number | null;              // difficulty fit with that part (null: no difficulty evidence, 0.5 used)
  D_by_part: Record<MatchPart, number | null>;
  T: number; I: number; A: number; Dm: number; L: number; F: number;
  why: string;
}

export interface MatchInfo {
  match: Record<MatchCat, CatMatch>;
  best: { category: MatchCat; part: MatchPart; match: number };
  levels: number[] | null;       // share of questions at L1..L5
  level_source: string;
  level_note?: string | null;
  modality?: string | null;
  questions_public?: string | null;
  questions_where?: string | null;
  n_questions?: number | null;
  per_question_results?: string | null;
  results_where?: string | null;
  licence?: string | null;
  overlap?: string | null;
  summary?: string | null;
  confidence?: string | null;
  sources?: string[] | null;
  live_overlap?: boolean;        // shares questions with a live Yugos set (dedupe; never use those for testing)
  adjusted?: string[];           // hand corrections from data/yugos-match/overrides.csv
}

export interface MatchTargets {
  [cat: string]: { label: string; parts: Record<MatchPart, { label: string; levels: number[] | null }> };
}

export interface SubMatchFile { built_at: string; weights: Record<string, number>; targets: MatchTargets; rows: Record<string, MatchInfo & { no: string }> }

export interface AnchorScore { model: string; score: number; source: string }

export interface DatasetMatch extends MatchInfo {
  id: string;
  name: string;
  hf: string | null;
  url: string | null;
  group: string;                 // first-guess category, or "router" (per-question outcome data)
  yugos: "" | "live" | "catalog";
  list_no: string | null;
  anchor_scores?: Record<string, AnchorScore | null> | null;
  release_year?: number | string | null;
  languages?: string[] | null;
  hub: { licence?: string | null; gated?: boolean | string | null; created?: string | null; last_modified?: string | null; downloads?: number | null; rows_total?: number | null };
}

export interface DatasetMatchFile { built_at: string; weights: Record<string, number>; targets: MatchTargets; datasets: DatasetMatch[] }

/** the three category scores of a row, or of a parent (best of its sub-benchmarks) */
export type MatchTriple = Record<MatchCat, number>;
export const tripleOf = (m: MatchInfo): MatchTriple => ({ chat: m.match.chat.match, math_code: m.match.math_code.match, agentic: m.match.agentic.match });

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);

export const FACTOR_INFO: { key: "T" | "I" | "A" | "Dm" | "L" | "F" | "D"; label: string; weight: string; help: string }[] = [
  { key: "T", label: "Task fit", weight: "×", help: "Same skill as the category's questions? Multiplies everything: a different skill teaches the router the wrong mapping." },
  { key: "I", label: "Turns", weight: "15%", help: "Turn structure: one prompt, tool schemas, or a multi-turn conversation with tools." },
  { key: "A", label: "Answer", weight: "15%", help: "Answer format and grading (letter, short answer, judge, F1, unit tests, end state)." },
  { key: "Dm", label: "Domain", weight: "15%", help: "Topics, libraries or tool domains compared with the category's mix." },
  { key: "D", label: "Difficulty", weight: "15%", help: "Level mix (L1-L5) compared with the Yugos part it stands in for: 1 − the share of questions that would have to move." },
  { key: "F", label: "Fresh", weight: "10%", help: "Release date, memorization risk, and question overlap with live Yugos sets." },
  { key: "L", label: "Length", weight: "5%", help: "Prompt length compared with the category's typical prompts." },
];

export const LEVEL_SHORT = ["L1", "L2", "L3", "L4", "L5"];

/** the live Yugos sets an overlap note names, by id ("hle", "mmlu_pro"), in the given order */
export function liveSetsIn(note: string | null | undefined, liveIds: string[]): string[] {
  if (!note) return [];
  return liveIds.filter((id) => new RegExp(`(?<![\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(note));
}
