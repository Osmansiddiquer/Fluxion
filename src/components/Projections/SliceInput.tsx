import { useState } from 'react';
import { fmtSig } from '../../lib/format';

/**
 * Panel slice input. Accepts a plain number or an expression in the variable
 * scope (e.g. "k", "k/2"). While not focused it shows the live resolved value
 * (or the expression text when one is driving the cut parametrically).
 */
export default function SliceInput({
  value,
  expr,
  invalid,
  onCommit,
}: {
  value: number;
  expr?: string;
  invalid?: boolean;
  onCommit: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const display = expr ?? fmtSig(value);

  return (
    <input
      className={`slice-input${invalid ? ' slice-input-invalid' : ''}`}
      title={invalid ? 'Undefined variable' : undefined}
      value={editing ? text : display}
      onFocus={() => {
        setText(display);
        setEditing(true);
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setEditing(false);
        onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
