// Server-side only: the Yugos match files (built by scripts/build_yugos_match.py).
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DatasetMatchFile, SubMatchFile } from "./yugosMatch";

const DIR = path.join(process.cwd(), "..", "data", "yugos-match");

export async function readSubMatches(): Promise<SubMatchFile | null> {
  try { return JSON.parse(await readFile(path.join(DIR, "subbenchmarks.json"), "utf8")) as SubMatchFile; } catch { return null; }
}

export async function readDatasetMatches(): Promise<DatasetMatchFile | null> {
  try { return JSON.parse(await readFile(path.join(DIR, "datasets.json"), "utf8")) as DatasetMatchFile; } catch { return null; }
}
