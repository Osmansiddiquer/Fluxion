import { useState } from 'react';
import { useStore } from '../../store/useStore';
import type { Entry } from '../../store/types';
import { formatPi, parsePi } from '../../lib/math/piFormat';

const TWO_PI = Math.PI * 2;

/** A π-aware text field: shows values like "2π" / "π/2", accepts "6pi", "pi/2", "4". */
function PiField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const display = formatPi(value);
  return (
    <input
      className="polar-bound"
      value={editing ? text : display}
      onFocus={() => {
        setText(display);
        setEditing(true);
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const v = parsePi(text);
        if (v != null) onCommit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

/** θ sweep range for a polar curve (defaults to 0 … 2π), shown in multiples of π. */
export default function PolarControls({ entry }: { entry: Entry }) {
  const update = useStore((s) => s.updateEntry);
  return (
    <div className="polar-ctrl">
      <span className="polar-label">θ</span>
      <PiField value={entry.thetaMin ?? 0} onCommit={(n) => update(entry.id, { thetaMin: n })} />
      <span className="polar-arrow">→</span>
      <PiField value={entry.thetaMax ?? TWO_PI} onCommit={(n) => update(entry.id, { thetaMax: n })} />
    </div>
  );
}
