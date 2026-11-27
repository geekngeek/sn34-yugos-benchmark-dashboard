"use client";

import { useState } from "react";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: f.get("username"), password: f.get("password") }),
      });
      if (!r.ok) { setError((await r.json().catch(() => null))?.error ?? "Login failed."); return; }
      const next = new URLSearchParams(location.search).get("next");
      // only same-site paths, never "//other.site"
      location.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch { setError("Could not reach the server."); }
    finally { setBusy(false); }
  }

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <div><p className="login-app">Yugos benchmarks</p><h1>Sign in</h1></div>
        <label>Username<input name="username" autoComplete="username" required autoFocus /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        {error && <p className="login-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="login-note">You stay signed in for 7 days after your last visit.</p>
      </form>
    </main>
  );
}
