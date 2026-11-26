// Server-side only: named model selections (Save / Load in the model picker), shared by everyone.
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const FILE = path.join(process.cwd(), "..", "data", "model-selections.json");

export interface ModelSelection { name: string; configs: string[]; saved: string }

export async function readSelections(): Promise<ModelSelection[]> {
  try {
    return (JSON.parse(await readFile(FILE, "utf8")).selections ?? []) as ModelSelection[];
  } catch {
    return [];
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** add or replace a selection by name; configs null removes it */
export function saveSelection(name: string, configs: string[] | null): Promise<ModelSelection[]> {
  const job = queue.then(async () => {
    const list = (await readSelections()).filter((s) => s.name !== name);
    if (configs) list.push({ name, configs, saved: new Date().toISOString() });
    list.sort((a, b) => a.name.localeCompare(b.name));
    const tmp = `${FILE}.tmp`;
    await writeFile(tmp, JSON.stringify({ selections: list }, null, 1), "utf8");
    await rename(tmp, FILE);
    return list;
  });
  queue = job.catch(() => undefined);
  return job;
}
