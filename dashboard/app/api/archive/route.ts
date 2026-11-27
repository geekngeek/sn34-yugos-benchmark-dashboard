import { ARCHIVE_PAGES, setArchived, type ArchivePage } from "@/lib/archive";
import { updateState } from "@/lib/yugosModels";

/**
 * POST {page, archive: [{id, label}], note?}  archive rows of a page (note: an optional reason, kept with each row)
 * POST {page, restore: [id, …]}         bring them back
 * Archiving a Yugos model also takes it out of the selection (restoring leaves it unselected).
 */
export async function POST(req: Request) {
  let body: { page?: unknown; archive?: unknown; restore?: unknown; note?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  const page = body.page as ArchivePage;
  if (!ARCHIVE_PAGES.includes(page)) return Response.json({ error: `page must be one of ${ARCHIVE_PAGES.join(", ")}` }, { status: 400 });

  const str = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 300;
  const add = Array.isArray(body.archive)
    ? body.archive.filter((r): r is { id: string; label: string } => !!r && str(r.id) && typeof r.label === "string").map((r) => ({ id: r.id, label: r.label.slice(0, 300) }))
    : [];
  const note = typeof body.note === "string" ? body.note.replace(/\r\n/g, "\n").trim().slice(0, 2000) : "";
  const back = Array.isArray(body.restore) ? body.restore.filter(str) : [];
  if (!add.length && !back.length) return Response.json({ error: "send {page, archive: [{id, label}]} or {page, restore: [id]}" }, { status: 400 });

  if (page === "yugos-models" && add.length) {
    await updateState((st) => { st.excluded = [...new Set([...st.excluded, ...add.map((r) => r.id)])].sort(); });
  }
  const map = await setArchived(page, [...add.map((r) => ({ ...r, note })), ...back.map((id) => ({ id, label: null }))]);
  return Response.json({ ok: true, archived: map });
}
