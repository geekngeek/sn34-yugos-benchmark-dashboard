"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/benchmarks", label: "Benchmark list" },
  { href: "/yugos-models", label: "Yugos models" },
  { href: "/router-benchmarks", label: "Router benchmarks" },
  { href: "/datasets", label: "Datasets" },
];

/** top navigation between the app's pages */
export function Tabs() {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <nav className="tabs" aria-label="Pages">
      <div className="tabs-inner">
        <span className="tabs-brand">Yugos benchmarks</span>
        {TABS.map((t) => {
          const on = path.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} className={`tab${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
              {t.label}
            </Link>
          );
        })}
        <button type="button" className="tab tab-logout" title="Sign out"
                onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); location.replace("/login"); }}>
          Sign out
        </button>
      </div>
    </nav>
  );
}
