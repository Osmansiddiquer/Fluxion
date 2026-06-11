import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import type { Entry } from '../../store/types';
import { parseEntry } from '../../lib/math/parse';
import { entryToLatex } from '../../lib/math/tolatex';
import { latexToText } from '../../lib/math/fromlatex';
import MathField from './MathField';

/**
 * Inline editable math row (MathLive). The entry's `raw` text remains the source
 * of truth for the solver; we derive LaTeX from it for display, and convert the
 * editor's LaTeX back to text on every edit.
 */
export default function EquationField({ entry }: { entry: Entry }) {
  const update = useStore((s) => s.updateEntry);
  const sigFigs = useStore((s) => s.sigFigs);

  const latexValue = useMemo(() => {
    if (!entry.raw.trim()) return '';
    const parsed = parseEntry(entry.raw);
    const l = entryToLatex(parsed, entry.varValue);
    // Fallback: feed the raw text (valid-enough LaTeX) while a parse error stands.
    return l ?? entry.raw;
    // sigFigs affects displayed variable/value formatting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.raw, entry.varValue, sigFigs]);

  return (
    <div className="eqfield">
      <MathField
        className="math-field"
        value={latexValue}
        onChange={(latex) => {
          const text = latexToText(latex);
          update(entry.id, { raw: text, varValue: undefined });
        }}
      />
    </div>
  );
}
