// Server-side only: the Yugos model catalog and the user's notes / watch list.
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DIR = path.join(process.cwd(), "..", "data", "yugos");
const CATALOG = path.join(DIR, "models.json");      // built by scripts/build_yugos_models.py
const STATE = path.join(DIR, "user-state.json");    // written by this app: notes + excluded models

export interface Offer {
  provider: string;
  id: string;
  in: number | null;
  out: number | null;
  cached: number | null;
  efforts: string[];
  valid_until: string | null;
}

export interface YugosModel {
  model: string;
  vendor: string;
  line: string;
  parent: string | null;
  successor: string | null;
  released: string | null;
  in_usd_m: number | null;
  out_usd_m: number | null;
  price_source: string;
  cheapest_out_usd_m: number | null;
  cheapest_provider: string;
  efforts: string[];
  providers: string[];
  valid_until: string | null;
  kind: string;
  track: string;
  reference_url: string | null;
  reference_label: string;
  offers: Offer[];
}

export interface Catalog {
  built: string;
  world_card: { sha256: string | null; synced_at: string | null; world_state_id: string | null; url: string };
  notes: string[];
  models: YugosModel[];
}

export interface UserState {
  notes: Record<string, string>;
  /** models taken out of observation; everything else is watched, so new models start selected */
  excluded: string[];
  updated: string | null;
}

export async function readCatalog(): Promise<Catalog> {
  return JSON.parse(await readFile(CATALOG, "utf8"));
}

export async function readState(): Promise<UserState> {
  try {
    const s = JSON.parse(await readFile(STATE, "utf8"));
    return { notes: s.notes ?? {}, excluded: s.excluded ?? [], updated: s.updated ?? null };
  } catch {
    return { notes: {}, excluded: [], updated: null };
  }
}

// one write at a time, so two quick saves can't overwrite each other
let queue: Promise<unknown> = Promise.resolve();

export function updateState(change: (s: UserState) => void): Promise<UserState> {
  const job = queue.then(async () => {
    const s = await readState();
    change(s);
    s.updated = new Date().toISOString();
    const tmp = `${STATE}.tmp`;
    await writeFile(tmp, JSON.stringify(s, null, 1), "utf8");
    await rename(tmp, STATE);   // readers never see a half-written file
    return s;
  });
  queue = job.catch(() => undefined);
  return job;
}
