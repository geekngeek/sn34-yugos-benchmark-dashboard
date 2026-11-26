import { saveLayout } from "@/lib/uiLayout";

const ID = /^[a-z0-9-]{1,64}$/;
const KEY = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * POST {id, order: string[], widths: {key: px}}  save a table's column layout
 * POST {id, reset: true}                          forget it (back to the table's defaults)
 */
export async function POST(req: Request) {
  let body: { id?: unknown; order?: unknown; widths?: unknown; reset?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  const { id } = body;
  if (typeof id !== "string" || !ID.test(id)) return Response.json({ error: "bad table id" }, { status: 400 });
  if (body.reset === true) { await saveLayout(id, null); return Response.json({ ok: true }); }

  const order = Array.isArray(body.order) ? body.order.filter((k): k is string => typeof k === "string" && KEY.test(k)).slice(0, 60) : [];
  const widths: Record<string, number> = {};
  if (body.widths && typeof body.widths === "object") {
    for (const [k, v] of Object.entries(body.widths as Record<string, unknown>).slice(0, 60)) {
      if (KEY.test(k) && typeof v === "number" && Number.isFinite(v)) widths[k] = Math.round(Math.min(2000, Math.max(16, v)));
    }
  }
  await saveLayout(id, { order: [...new Set(order)], widths });
  return Response.json({ ok: true });
}
