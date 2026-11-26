// Server-side only: colours chosen per developer for the trade-off chart, shared by everyone.
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const FILE = path.join(process.cwd(), "..", "data", "chart-colors.json");

export async function readChartColors(): Promise<Record<string, string>> {
  try {
    return (JSON.parse(await readFile(FILE, "utf8")).developers ?? {}) as Record<string, string>;
  } catch {
    return {};
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** set one developer's colour (null = back to the default); all = null resets every developer */
export function saveChartColor(developer: string | null, color: string | null): Promise<Record<string, string>> {
  const job = queue.then(async () => {
    const colors = developer === null ? {} : await readChartColors();
    if (developer !== null) {
      if (color) colors[developer] = color; else delete colors[developer];
    }
    const tmp = `${FILE}.tmp`;
    await writeFile(tmp, JSON.stringify({ developers: colors }, null, 1), "utf8");
    await rename(tmp, FILE);
    return colors;
  });
  queue = job.catch(() => undefined);
  return job;
}
