import { useEffect, useRef, useState } from 'react';
import 'mathlive';
import { MathfieldElement } from 'mathlive';
import { suggestionsFor } from '../../lib/math/suggest';
import { latexToText } from '../../lib/math/fromlatex';

// MathLive needs its symbol fonts; serve them from a CDN matching the lib version.
// (For fully offline/static hosting these can later be copied into /public.)
MathfieldElement.fontsDirectory = 'https://cdn.jsdelivr.net/npm/mathlive/dist/fonts/';
MathfieldElement.soundsDirectory = null;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'math-field': React.DetailedHTMLProps<
        React.HTMLAttributes<MathfieldElement>,
        MathfieldElement
      >;
    }
  }
}

export default function MathField({
  value,
  onChange,
  onEnter,
  onFocusChange,
  className,
  varNames,
}: {
  /** LaTeX to display (applied only while the field is not focused). */
  value: string;
  /** Fires with the field's LaTeX on every edit. */
  onChange: (latex: string) => void;
  onEnter?: () => void;
  onFocusChange?: (focused: boolean) => void;
  className?: string;
  /** Defined variable names, offered as autocomplete suggestions. */
  varNames?: string[];
}) {
  const ref = useRef<MathfieldElement>(null);
  const focused = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const cbs = useRef({ onChange, onEnter, onFocusChange });
  cbs.current = { onChange, onEnter, onFocusChange };
  const varNamesRef = useRef(varNames ?? []);
  varNamesRef.current = varNames ?? [];

  // Autocomplete state. Refs mirror it for the (once-registered) keydown handler.
  const [suggs, setSuggs] = useState<string[]>([]);
  const [sel, setSel] = useState(0);
  const tokenRef = useRef('');
  const suggsRef = useRef<string[]>([]);
  const selRef = useRef(0);
  suggsRef.current = suggs;
  selRef.current = sel;

  const accept = (i: number) => {
    const mf = ref.current;
    const pick = suggsRef.current[i];
    if (!mf || !pick) return;
    mf.insert(pick.slice(tokenRef.current.length));
    setSuggs([]);
    cbs.current.onChange(mf.value);
  };
  const acceptRef = useRef(accept);
  acceptRef.current = accept;

  useEffect(() => {
    const mf = ref.current;
    if (!mf) return;
    mf.mathVirtualKeyboardPolicy = 'manual';
    mf.smartMode = false;
    // Remove English-word operator shortcuts (in, and, …) that mangle identifiers
    // and function names like "polyline" (the "in" became ∈). Keep Greek/functions.
    try {
      const sc = { ...(mf.inlineShortcuts as Record<string, unknown>) };
      for (const k of ['in', 'and', 'or', 'not', 'to', 'exists', 'forall', 'nin', 'ni', 'union', 'intersection', 'setminus', 'xor']) {
        delete sc[k];
      }
      mf.inlineShortcuts = sc as typeof mf.inlineShortcuts;
    } catch {
      /* ignore */
    }
    if (className) mf.className = className;
    mf.value = value;

    const refreshSuggestions = () => {
      const text = latexToText(mf.value);
      const m = /([A-Za-z][A-Za-z0-9]*)$/.exec(text);
      const token = m && m[1].length >= 2 ? m[1] : '';
      tokenRef.current = token;
      const list = token ? suggestionsFor(token, varNamesRef.current) : [];
      setSuggs(list);
      setSel(0);
    };

    const onInput = () => {
      cbs.current.onChange(mf.value);
      refreshSuggestions();
    };
    const onFocusIn = () => {
      focused.current = true;
      cbs.current.onFocusChange?.(true);
    };
    const onFocusOut = () => {
      focused.current = false;
      cbs.current.onFocusChange?.(false);
      setSuggs([]);
      // Re-feed the canonical LaTeX after editing so editor-internal forms (e.g.
      // \doubleprime, which renders oddly) normalise to our display form.
      requestAnimationFrame(() => {
        if (!focused.current) mf.value = valueRef.current;
      });
    };
    const onKey = (e: KeyboardEvent) => {
      const list = suggsRef.current;
      if (list.length) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSel((s) => (s + 1) % list.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSel((s) => (s - 1 + list.length) % list.length);
          return;
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && list.length)) {
          e.preventDefault();
          acceptRef.current(selRef.current);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setSuggs([]);
          return;
        }
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        mf.blur();
        cbs.current.onEnter?.();
      }
    };
    mf.addEventListener('input', onInput);
    mf.addEventListener('focusin', onFocusIn);
    mf.addEventListener('focusout', onFocusOut);
    mf.addEventListener('keydown', onKey);
    return () => {
      mf.removeEventListener('input', onInput);
      mf.removeEventListener('focusin', onFocusIn);
      mf.removeEventListener('focusout', onFocusOut);
      mf.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply external value changes only when the user isn't actively editing.
  // Throttle to ~20 fps so a fast-changing value (animated slider) doesn't re-render
  // the math field every frame, with a trailing apply so the final value lands.
  const lastApply = useRef(0);
  useEffect(() => {
    const mf = ref.current;
    if (!mf || focused.current) return;
    const apply = () => {
      if (!focused.current && ref.current && ref.current.value !== valueRef.current) {
        ref.current.value = valueRef.current;
        lastApply.current = performance.now();
      }
    };
    const since = performance.now() - lastApply.current;
    if (since >= 50) {
      apply();
      return;
    }
    const id = window.setTimeout(apply, 50 - since);
    return () => clearTimeout(id);
  }, [value]);

  return (
    <span className="mf-wrap">
      <math-field ref={ref} />
      {suggs.length > 0 && (
        <ul className="mf-suggest" role="listbox">
          {suggs.map((s, i) => (
            <li
              key={s}
              role="option"
              aria-selected={i === sel}
              className={i === sel ? 'sel' : undefined}
              // pointerdown (not click) so it fires before the field blurs.
              onPointerDown={(e) => {
                e.preventDefault();
                accept(i);
              }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
