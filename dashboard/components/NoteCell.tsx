"use client";

import { useEffect, useState } from "react";

/**
 * A note in a table cell. Click to edit; Enter or leaving the box saves, Shift+Enter adds a line, Esc cancels.
 * `cls` is the class prefix for the page's own styles: `${cls}-note`, `${cls}-note empty`, `${cls}-note-input`.
 */
export function NoteCell({ value, onSave, label, cls = "ym" }: { value: string; onSave: (v: string) => void; label: string; cls?: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  useEffect(() => { if (!editing) setText(value); }, [value, editing]);
  if (!editing) {
    return (
      <button type="button" className={`${cls}-note${value ? "" : " empty"}`} onClick={(e) => { e.stopPropagation(); setEditing(true); }} title={value || "Add a note"}>
        {value || "+ note"}
      </button>
    );
  }
  return (
    <textarea autoFocus className={`${cls}-note-input`} value={text} aria-label={`Note for ${label}`} rows={Math.min(6, Math.max(2, text.split("\n").length))}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { setEditing(false); onSave(text); }}
      onKeyDown={(e) => {
        e.stopPropagation();   // the row's Enter/Space would open the detail panel
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
        if (e.key === "Escape") { setText(value); setEditing(false); }
      }} />
  );
}
