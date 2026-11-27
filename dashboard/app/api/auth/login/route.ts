import { NextResponse } from "next/server";
import { checkLogin, COOKIE, cookieOptions, isHttps, makeToken } from "@/lib/auth";

// failed attempts per client: 5 within 15 minutes locks that client out for the rest of the window
const WINDOW_MS = 15 * 60 * 1000, MAX_FAILS = 5;
const fails = new Map<string, { n: number; since: number }>();

const clientOf = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";

export async function POST(req: Request) {
  const who = clientOf(req), now = Date.now();
  const f = fails.get(who);
  if (f && now - f.since > WINDOW_MS) fails.delete(who);
  const cur = fails.get(who);
  if (cur && cur.n >= MAX_FAILS)
    return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });

  let body: { username?: unknown; password?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid request" }, { status: 400 }); }
  const user = typeof body.username === "string" ? body.username.slice(0, 200) : "";
  const pass = typeof body.password === "string" ? body.password.slice(0, 200) : "";

  if (!checkLogin(user, pass)) {
    fails.set(who, { n: (cur?.n ?? 0) + 1, since: cur?.since ?? now });
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: "Wrong username or password." }, { status: 401 });
  }
  fails.delete(who);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, makeToken(user), cookieOptions(isHttps(req)));
  return res;
}
