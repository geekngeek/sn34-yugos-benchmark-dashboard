import { saveMyNote } from "@/lib/benchmarkList";

/** POST {no, name, note}: save a "My notes" cell in the benchmark list CSV. */
export async function POST(req: Request) {
  let body: { no?: unknown; name?: unknown; note?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  const { no, name, note } = body;
  if (typeof no !== "string" || typeof name !== "string" || typeof note !== "string") {
    return Response.json({ error: "no, name and note must be strings" }, { status: 400 });
  }
  if (note.length > 5000) return Response.json({ error: "note is longer than 5000 characters" }, { status: 400 });
  try {
    await saveMyNote(no.trim(), name.trim(), note.replace(/\r\n/g, "\n").trim());
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 });
  }
}
