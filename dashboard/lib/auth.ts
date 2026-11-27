import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";

// Stateless session: cookie = "<user>.<expires ms>.<HMAC-SHA256 of both>", signed with AUTH_SECRET.
export const COOKIE = "bench_session";
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET is not set (dashboard/.env.local)");
  return s;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

function same(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function makeToken(user: string, now = Date.now()): string {
  const payload = `${user}.${now + WEEK_MS}`;
  return `${payload}.${sign(payload)}`;
}

/** the user of a valid, unexpired token, else null */
export function readToken(token: string | undefined, now = Date.now()): { user: string; expires: number } | null {
  if (!token) return null;
  const i = token.lastIndexOf("."), j = token.lastIndexOf(".", i - 1);
  if (i < 0 || j < 0) return null;
  const payload = token.slice(0, i), user = token.slice(0, j), expires = Number(token.slice(j + 1, i));
  if (!same(sign(payload), token.slice(i + 1)) || !Number.isFinite(expires) || expires <= now) return null;
  if (user !== process.env.AUTH_USER) return null;
  return { user, expires };
}

export function checkLogin(user: string, password: string): boolean {
  const want = process.env.AUTH_USER ?? "", stored = process.env.AUTH_PASSWORD_SCRYPT ?? "";
  const [salt, hash] = stored.split(":");
  if (!want || !salt || !hash) return false;
  const got = scryptSync(password, Buffer.from(salt, "hex"), 64, { N: 16384, r: 8, p: 1 });
  const pwOk = timingSafeEqual(got, Buffer.from(hash, "hex"));
  return same(user, want) && pwOk;
}

export const cookieOptions = (secure: boolean) =>
  ({ httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: WEEK_MS / 1000 });

/** https when served directly or through a proxy that says so */
export const isHttps = (req: Request) =>
  new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
