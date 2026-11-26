// Search text and model names with the same loose spelling rules the build script uses for model ids:
// "Claude Opus 4.7" = "claude-opus-4-7" = "claude_opus_4.7".

/** lower case, "4-7" -> "4.7" (but not "3-235b"), separators -> single spaces */
export function normText(s: string): string {
  let n = s.toLowerCase();
  for (let i = 0; i < 2; i++) n = n.replace(/(^|[^\d.])(\d)-(\d)(?!\d)/g, "$1$2.$3");   // twice: "3-1-pro" chains
  return n.replace(/[\s_\-/:,;()[\]"'`|]+/g, " ").trim();
}

export const tokens = (s: string): string[] => normText(s).split(" ").filter(Boolean);

/** "6" matches "6" and "6.2" but not "60"; "opus" matches "opus"; "sonn" matches "sonnet" while typing */
function tokenMatch(q: string, t: string): boolean {
  if (!t.startsWith(q)) return false;
  return !(/\d$/.test(q) && /^\d/.test(t.slice(q.length)));
}

/** every query token matches a token of the model name, in any order */
export function modelMatches(queryTokens: string[], name: string): boolean {
  if (!queryTokens.length) return false;
  const ts = tokens(name);
  return queryTokens.every((q) => ts.some((t) => tokenMatch(q, t)));
}

/** every query token appears somewhere in the text (after the same normalising) */
export function textMatches(queryTokens: string[], normalisedText: string): boolean {
  return queryTokens.every((q) => normalisedText.includes(q));
}
