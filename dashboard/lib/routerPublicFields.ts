// Shared by server and browser code (lib/routerBenchmarks.ts reads files, so the table can't import values from it).

export type PublicStatus = "Yes" | "Partial" | "No" | "?";
/** the per-question fields the public-fields research checks, in display order */
export const PUBLIC_FIELDS = ["Prompt", "Model", "Answer", "Score", "Cost", "Tokens", "Effort"] as const;
export type PublicField = (typeof PUBLIC_FIELDS)[number];
