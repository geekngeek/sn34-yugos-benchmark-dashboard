import { readRouterBenchmarks, updateRouterState } from "@/lib/routerBenchmarks";

/**
 * POST {name, note}            save one benchmark's feedback note ("" clears it)
 * POST {name, archived: bool}  archive (hide) or unarchive one benchmark
 */
export async function POST(req: Request) {
  let body: { name?: unknown; note?: unknown; archived?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  const { name, note, archived } = body;
  if (typeof name !== "string") return Response.json({ error: "send {name, note} or {name, archived}" }, { status: 400 });
  const known = new Set((await readRouterBenchmarks()).benchmarks.map((b) => b.name));
  if (!known.has(name)) return Response.json({ error: `unknown benchmark "${name}"` }, { status: 404 });

  if (typeof archived === "boolean") {
    await updateRouterState((st) => {
      const set = new Set(st.archived);
      if (archived) set.add(name); else set.delete(name);
      st.archived = [...set].sort();
    });
    return Response.json({ ok: true });
  }
  if (typeof note !== "string") return Response.json({ error: "send {name, note} or {name, archived}" }, { status: 400 });
  if (note.length > 5000) return Response.json({ error: "note is longer than 5000 characters" }, { status: 400 });
  const text = note.replace(/\r\n/g, "\n").trim();
  await updateRouterState((st) => { if (text) st.notes[name] = text; else delete st.notes[name]; });
  return Response.json({ ok: true });
}
