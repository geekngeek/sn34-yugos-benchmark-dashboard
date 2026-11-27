import { NextResponse } from "next/server";
import { COOKIE, cookieOptions, isHttps } from "@/lib/auth";

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { ...cookieOptions(isHttps(req)), maxAge: 0 });
  return res;
}
