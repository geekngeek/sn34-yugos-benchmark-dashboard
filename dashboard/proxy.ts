import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, cookieOptions, isHttps, makeToken, readToken, WEEK_MS } from "@/lib/auth";

const OPEN = new Set(["/login", "/api/auth/login"]);
const REFRESH_AFTER_MS = 60 * 1000;   // re-sign at most once a minute, so the week counts from the last visit

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const session = readToken(req.cookies.get(COOKIE)?.value);

  if (OPEN.has(pathname)) {
    if (session && pathname === "/login") return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }
  if (!session) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "login required" }, { status: 401 });
    const to = new URL("/login", req.url);
    if (pathname !== "/") to.searchParams.set("next", pathname + search);
    return NextResponse.redirect(to);
  }
  const res = NextResponse.next();
  if (session.expires - Date.now() < WEEK_MS - REFRESH_AFTER_MS)
    res.cookies.set(COOKIE, makeToken(session.user), cookieOptions(isHttps(req)));
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
