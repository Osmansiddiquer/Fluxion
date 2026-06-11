import { useEffect, useRef, useState } from 'react';

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) < 1e-12) return '0';
  return Number(n.toPrecision(8)).toString();
}

/**
 * A numeric input that lets you type freely — including intermediate states like
 * "-", "2." or "0.05" — without the value being coerced mid-keystroke. Commits a
 * parsed number live whenever the text is a valid number, and normalises on blur.
 */
export default function NumberField({
  value,
  onCommit,
  className,
  ariaLabel,
  step,
}: {
  value: number;
  onCommit: (n: number) => void;
  className?: string;
  ariaLabel?: string;
  step?: number;
}) {
  const [text, setText] = useState(() => fmt(value));
  const focused = useRef(false);

  // Resync from the outside value (e.g. slider drag) only when not editing.
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      aria-label={ariaLabel}
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = Number(t);
        if (t.trim() !== '' && Number.isFinite(n)) onCommit(n);
      }}
      onBlur={() => {
        focused.current = false;
        const n = Number(text);
        if (text.trim() !== '' && Number.isFinite(n)) {
          onCommit(n);
          setText(fmt(n));
        } else {
          setText(fmt(value));
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      data-step={step}
    />
  );
}
