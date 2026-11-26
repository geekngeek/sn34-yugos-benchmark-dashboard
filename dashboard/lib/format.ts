export function formatScore(value: number | null, unit: string | null): string {
  if (value === null || value === undefined) return "—";
  if (unit === "percentage") return `${value.toFixed(1)}%`;
  if (unit === "elo") return Math.round(value).toLocaleString("en-US");
  return value.toFixed(1);
}

export function formatPercent(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)}%`;
}

export function formatUsd(value: number | null): string {
  if (value === null || value === undefined) return "—";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toPrecision(2)}`;
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function formatNumber(value: number | null, digits = 0): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-02-17" -> "17 Feb 2026" (calendar date, no timezone shift) */
export function formatDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : value;
}

export function effortLabel(effort: string | null): string {
  if (!effort) return "—";
  if (effort === "enabled") return "reasoning on";
  if (effort === "none") return "no reasoning";
  return effort;
}

export function benchmarkTitle(name: string, version: string | null): string {
  return version ? `${name} ${version}` : name;
}
