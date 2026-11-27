// Server-side only: rows the team archived on a page (hidden from the page, listed under "Archived", restorable).
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const FILE = path.join(process.cwd(), "..", "data", "archive.json");

/** the pages that can archive rows */
export const ARCHIVE_PAGES = ["benchmark-list", "yugos-models", "datasets"] as const;
export type ArchivePage = (typeof ARCHIVE_PAGES)[number];

/** one archived row: when, and its name at that time (so the Archived list can name it even if the row's source changes) */
export interface Archived { at: string; label: string; note?: string }   // note: the optional reason given when archiving
export type ArchiveMap = Record<string, Archived>;
type Store = { pages: Partial<Record<ArchivePage, ArchiveMap>> };

async function readStore(): Promise<Store> {
  try { return { pages: (JSON.parse(await readFile(FILE, "utf8")) as Store).pages ?? {} }; }
  catch { return { pages: {} }; }
}

export async function readArchive(page: ArchivePage): Promise<ArchiveMap> {
  return (await readStore()).pages[page] ?? {};
}

// one write at a time, so two quick clicks can't overwrite each other
let queue: Promise<unknown> = Promise.resolve();

/** archive (label given) or restore (label null) some rows of one page; returns that page's archive */
export function setArchived(page: ArchivePage, rows: { id: string; label: string | null; note?: string }[]): Promise<ArchiveMap> {
  const job = queue.then(async () => {
    const store = await readStore();
    const map = { ...(store.pages[page] ?? {}) };
    const at = new Date().toISOString();
    for (const r of rows) {
      if (r.label === null) delete map[r.id];
      else if (!map[r.id]) map[r.id] = r.note ? { at, label: r.label, note: r.note } : { at, label: r.label };
    }
    store.pages[page] = map;
    const tmp = `${FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(store, null, 1), "utf8");
    await rename(tmp, FILE);
    return map;
  });
  queue = job.catch(() => undefined);
  return job;
}
