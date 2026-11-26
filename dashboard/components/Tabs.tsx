"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Results" },
  { href: "/benchmarks", label: "Benchmark list" },
  { href: "/yugos-models", label: "Yugos models" },
  { href: "/router-benchmarks", label: "Router benchmarks" },
];

/** top navigation between the app's pages */
export function Tabs() {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label="Pages">
      <div className="tabs-inner">
        {TABS.map((t) => {
          const on = t.href === "/" ? path === "/" : path.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} className={`tab${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
