import { readCatalog, updateState } from "@/lib/yugosModels";

/**
 * POST {model, note}        save one model's note ("" clears it)
 * POST {excluded: string[]} replace the list of models taken out of observation
 */
export async function POST(req: Request) {
  let body: { model?: unknown; note?: unknown; excluded?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  const known = new Set((await readCatalog()).models.map((m) => m.model));

  if (Array.isArray(body.excluded)) {
    const excluded = body.excluded.filter((x): x is string => typeof x === "string" && known.has(x));
    const s = await updateState((st) => { st.excluded = [...new Set(excluded)].sort(); });
    return Response.json({ ok: true, excluded: s.excluded.length });
  }

  const { model, note } = body;
  if (typeof model !== "string" || typeof note !== "string") {
    return Response.json({ error: "send {model, note} or {excluded: [...]}" }, { status: 400 });
  }
  if (!known.has(model)) return Response.json({ error: `unknown model "${model}"` }, { status: 404 });
  if (note.length > 5000) return Response.json({ error: "note is longer than 5000 characters" }, { status: 400 });
  const text = note.replace(/\r\n/g, "\n").trim();
  await updateState((st) => { if (text) st.notes[model] = text; else delete st.notes[model]; });
  return Response.json({ ok: true });
}
