import { readChartColors, saveChartColor } from "@/lib/chartColors";

const HEX = /^#[0-9a-f]{6}$/i;

/** GET: the colour chosen per developer */
export async function GET() {
  return Response.json({ developers: await readChartColors() });
}

/**
 * POST {developer, color: "#rrggbb"} sets one developer's colour; {developer, color: null} puts its default back;
 * {reset: true} puts every developer back to the defaults.
 */
export async function POST(req: Request) {
  let body: { developer?: unknown; color?: unknown; reset?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  if (body.reset === true) return Response.json({ developers: await saveChartColor(null, null) });
  const developer = typeof body.developer === "string" ? body.developer.trim().slice(0, 80) : "";
  if (!developer) return Response.json({ error: "developer is required" }, { status: 400 });
  if (body.color !== null && !(typeof body.color === "string" && HEX.test(body.color))) {
    return Response.json({ error: "color must be #rrggbb or null" }, { status: 400 });
  }
  return Response.json({ developers: await saveChartColor(developer, body.color as string | null) });
}
