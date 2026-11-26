import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCsv, toCsv } from "@/lib/csv";

/** dashboard/public/benchmark-list.csv — the page, the download and note edits all use this one file */
export const LIST_FILE = "benchmark-list.csv";
export const LIST_PATH = path.join(process.cwd(), "public", LIST_FILE);
export const MY_NOTES = "My notes";

export async function readList(): Promise<{ header: string[]; rows: string[][] }> {
  const [header = [], ...rows] = parseCsv(await readFile(LIST_PATH, "utf8"));
  return { header: header.map((h) => h.trim()), rows };
}

// one write at a time, so two quick saves can't overwrite each other
let queue: Promise<unknown> = Promise.resolve();

/** Set the "My notes" cell of the row with this No (and Name, as a guard against a changed file). */
export function saveMyNote(no: string, name: string, note: string): Promise<void> {
  const job = queue.then(async () => {
    const { header, rows } = await readList();
    let col = header.indexOf(MY_NOTES);
    if (col < 0) { header.push(MY_NOTES); col = header.length - 1; }
    const nameCol = header.indexOf("Name");
    const row = rows.find((r) => (r[0] ?? "").trim() === no && (nameCol < 0 || (r[nameCol] ?? "").trim() === name));
    if (!row) throw new Error(`row ${no} "${name}" not found`);
    while (row.length < header.length) row.push("");
    row[col] = note;
    const tmp = `${LIST_PATH}.tmp`;
    await writeFile(tmp, toCsv([header, ...rows]), "utf8");
    await rename(tmp, LIST_PATH);   // readers never see a half-written file
  });
  queue = job.catch(() => undefined);
  return job;
}
