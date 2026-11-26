import { readSelections, saveSelection } from "@/lib/modelSelections";

const CONFIG = /^[a-z0-9][\w.+\-/~]{0,200}$/i;

/** GET: the saved model selections */
export async function GET() {
  return Response.json({ selections: await readSelections() });
}

/** POST {name, configs: string[]} saves (or replaces) one; POST {name, delete: true} removes it */
export async function POST(req: Request) {
  let body: { name?: unknown; configs?: unknown; delete?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) return Response.json({ error: "a name is required" }, { status: 400 });
  if (body.delete === true) return Response.json({ selections: await saveSelection(name, null) });
  if (!Array.isArray(body.configs)) return Response.json({ error: "configs must be a list" }, { status: 400 });
  const configs = [...new Set(body.configs.filter((c): c is string => typeof c === "string" && CONFIG.test(c)))].slice(0, 2000);
  return Response.json({ selections: await saveSelection(name, configs) });
}
