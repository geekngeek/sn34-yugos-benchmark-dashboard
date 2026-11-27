"use client";

/**
 * A min–max range on one track: two handles (drag or arrow keys) plus number boxes for exact values.
 * Values are whole numbers between `lo` and `hi`; the handles never cross.
 */
export function RangeSlider({ min, max, lo = 0, hi = 100, step = 1, unit = "%", onChange, label }: {
  min: number; max: number; lo?: number; hi?: number; step?: number; unit?: string; label: string;
  onChange: (min: number, max: number) => void;
}) {
  const clamp = (v: number) => Math.min(hi, Math.max(lo, Math.round(v / step) * step));
  const setMin = (v: number) => onChange(Math.min(clamp(v), max), max);
  const setMax = (v: number) => onChange(min, Math.max(clamp(v), min));
  const pct = (v: number) => ((v - lo) / (hi - lo)) * 100;
  return (
    <div className="rs" role="group" aria-label={label}>
      <div className="rs-track">
        <span className="rs-fill" style={{ left: `${pct(min)}%`, right: `${100 - pct(max)}%` }} />
        <input type="range" min={lo} max={hi} step={step} value={min} aria-label={`${label}: from`} onChange={(e) => setMin(Number(e.target.value))} />
        <input type="range" min={lo} max={hi} step={step} value={max} aria-label={`${label}: to`} onChange={(e) => setMax(Number(e.target.value))} />
      </div>
      <div className="rs-nums">
        <label>From <input type="number" min={lo} max={hi} step={step} value={min} onChange={(e) => setMin(Number(e.target.value))} />{unit}</label>
        <label>to <input type="number" min={lo} max={hi} step={step} value={max} onChange={(e) => setMax(Number(e.target.value))} />{unit}</label>
      </div>
    </div>
  );
}
