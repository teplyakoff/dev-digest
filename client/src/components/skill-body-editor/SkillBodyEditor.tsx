/* SkillBodyEditor — the monospace editor a skill body is written in, with a
   line gutter. Used by the skill Config tab and by the import preview, which
   the spec requires to show the incoming body in the same editor.

   Not the vendored `Textarea`: that primitive exposes neither a ref nor an
   `onScroll`, so a gutter cannot be kept in step with it, and `src/vendor/ui`
   is frozen. */
"use client";

import React from "react";
import { s } from "./styles";

export function SkillBodyEditor({
  value,
  onChange,
  rows = 18,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  ariaLabel?: string;
}) {
  const gutterRef = React.useRef<HTMLDivElement>(null);

  // A trailing newline means one more (empty) line to number; `split` already
  // yields that extra element, so the count needs no special case.
  const lineCount = value.split("\n").length;

  return (
    <div style={s.frame(rows)}>
      <div ref={gutterRef} style={s.gutter} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} style={s.gutterLine}>
            {i + 1}
          </div>
        ))}
      </div>
      <textarea
        className="mono"
        value={value}
        rows={rows}
        wrap="off"
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        // Vertical only: the gutter scrolls with the text, and horizontally
        // there is nothing in it to move.
        onScroll={(e) => {
          if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
        style={s.input}
      />
    </div>
  );
}
