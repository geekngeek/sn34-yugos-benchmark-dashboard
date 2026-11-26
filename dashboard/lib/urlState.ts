"use client";

import { useEffect } from "react";

/** the page's searchParams as the server hands them to a client component */
export type Query = Record<string, string | string[] | undefined>;

export const qOne = (q: Query | undefined, k: string): string => {
  const v = q?.[k];
  return (Array.isArray(v) ? v[0] : v) ?? "";
};
export const qMany = (q: Query | undefined, k: string): string[] => {
  const v = q?.[k];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
};
export const qFlag = (q: Query | undefined, k: string): boolean => ["1", "true", "yes"].includes(qOne(q, k));

/** a value for useQuerySync: a list repeats the parameter, true writes "1"; "", [], false, null leave it out */
export type QueryValue = string | string[] | boolean | null | undefined;

/**
 * Keep the address bar's query string in step with a page's view state, so a link (or reload)
 * reproduces exactly what is on screen. Replaces the URL in place: no reload, no new history entry.
 * Only the keys given here are touched; any other parameters stay as they are.
 */
export function useQuerySync(state: Record<string, QueryValue>) {
  const key = JSON.stringify(state);
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const [k, v] of Object.entries(state)) {
      url.searchParams.delete(k);
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else if (v === true) url.searchParams.set(k, "1");
      else if (typeof v === "string" && v !== "") url.searchParams.set(k, v);
    }
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, "", next);   // Next.js keeps its router in sync with this
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
