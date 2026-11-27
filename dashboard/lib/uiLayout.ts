// Server-side only: saved table column layouts (order + widths), shared by everyone using the dashboard.
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const FILE = path.join(process.cwd(), "..", "data", "ui-layout.json");

export interface TableLayout { order?: string[]; widths?: Record<string, number>; px?: boolean; pct?: boolean }   // pct: widths are shares of the box (per mille); px: older frozen px sizes
type Store = { tables: Record<string, TableLayout> };

export async function readLayouts(): Promise<Record<string, TableLayout>> {
  try {
    return (JSON.parse(await readFile(FILE, "utf8")) as Store).tables ?? {};
  } catch {
    return {};
  }
}

export async function readLayout(id: string): Promise<TableLayout | undefined> {
  return (await readLayouts())[id];
}

// one write at a time, so two quick saves can't overwrite each other
let queue: Promise<unknown> = Promise.resolve();

/** save one table's layout; null removes it (back to the defaults) */
export function saveLayout(id: string, layout: TableLayout | null): Promise<void> {
  const job = queue.then(async () => {
    const tables = await readLayouts();
    if (layout) tables[id] = layout; else delete tables[id];
    const tmp = `${FILE}.tmp`;
    await writeFile(tmp, JSON.stringify({ tables }, null, 1), "utf8");
    await rename(tmp, FILE);
  });
  queue = job.catch(() => undefined);
  return job;
}
