import { useEffect, useRef, useState } from 'react';
import 'mathlive';
import { MathfieldElement } from 'mathlive';
import { suggestionsFor } from '../../lib/math/suggest';
import { latexToText } from '../../lib/math/fromlatex';
import { editorShortcuts, suggestionLatex } from '../../lib/math/editorShortcuts';

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

// The bits of MathLive's (private) editing model we read to decide what a key
// should do. Guarded everywhere: if a MathLive update changes them, the field
// falls back to MathLive's own behaviour.
interface Atom {
  type: string;
  value?: string;
  parent?: Atom;
  parentBranch?: string;
  leftSibling?: Atom;
  isFirstSibling?: boolean;
  isLastSibling?: boolean;
}

/** Branches a relation or separator steps out of (exponent, subscript, fraction). */
const SCRIPT_OR_FRACTION = new Set(['superscript', 'subscript', 'above', 'below']);
function caretAtom(mf: MathfieldElement): Atom | undefined {
  try {
    const model = (mf as unknown as { _mathfield?: { model?: { position: number; at(i: number): Atom } } })._mathfield
      ?.model;
    return model ? model.at(model.position) : undefined;
  } catch {
    return undefined;
  }
}

/** Letters typed just before the caret (the word being completed), or null if
 * the model can't be read. */
function wordBeforeCaret(mf: MathfieldElement): string | null {
  let a = caretAtom(mf);
  if (!a) return null;
  let word = '';
  while (a && a.type === 'mord' && typeof a.value === 'string' && /^[A-Za-z0-9]$/.test(a.value)) {
    word = a.value + word;
    if (a.isFirstSibling) break;
    a = a.leftSibling;
  }
  const m = /[A-Za-z][A-Za-z0-9]*$/.exec(word);
  return m ? m[0] : '';
}

/** Where the caret sits: in a super/subscript, directly in a bracket, or other. */
function caretContainer(mf: MathfieldElement): { branch?: string; parentType?: string; empty: boolean } | null {
  const a = caretAtom(mf);
  if (!a) return null;
  // The atom left of the caret is the branch's 'first' sentinel when the caret
  // is at the start of the branch.
  return { branch: a.parentBranch, parentType: a.parent?.type, empty: a.type === 'first' };
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
    // Replace the typed prefix with the whole name (as the symbol it stands for:
    // \alpha, \sin, …) — never append to it, which left "si" + "n" as loose
    // letters and could glue onto an already-converted \sin.
    const typed = wordBeforeCaret(mf) ?? tokenRef.current;
    if (typed && pick.toLowerCase().startsWith(typed.toLowerCase())) {
      for (let k = 0; k < typed.length; k++) mf.executeCommand('deleteBackward');
      // A variable name is finished: a thin space keeps the next letter from
      // gluing onto it (amp then x is amp·x, not the name ampx).
      const tex = suggestionLatex(pick);
      mf.insert(tex === pick && pick.length > 1 ? `${tex}\\,` : tex, { format: 'latex', selectionMode: 'placeholder' });
    } else {
      mf.insert(pick.slice(tokenRef.current.length));
    }
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
    // Only the shortcuts that keep the text meaning what was typed: Greek words
    // and function names (sin → \sin). MathLive's defaults rewrite plain names
    // into other notation — mod → \bmod, log → \log_{□}, floor → ⌊□⌋, nthroot →
    // a radical, dx → a differential d, in → ∈ — which the parser can't read back.
    try {
      mf.inlineShortcuts = editorShortcuts(
        mf.inlineShortcuts as Record<string, unknown>,
      ) as typeof mf.inlineShortcuts;
    } catch {
      /* ignore */
    }
    if (className) mf.className = className;
    mf.value = value;

    const refreshSuggestions = () => {
      // The word at the caret (not the end of the whole expression, which is the
      // wrong word when editing in the middle).
      let token = wordBeforeCaret(mf);
      if (token == null) {
        const m = /([A-Za-z][A-Za-z0-9]*)$/.exec(latexToText(mf.value));
        token = m ? m[1] : '';
      }
      if (token.length < 2) token = '';
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
    // Capture phase: runs before MathLive's own handler (which would otherwise
    // take Tab to move focus, and Space to jump out of the bracket).
    const onKey = (e: KeyboardEvent) => {
      const list = suggsRef.current;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (list.length) {
        if (e.key === 'ArrowDown') {
          stop();
          setSel((s) => (s + 1) % list.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          stop();
          setSel((s) => (s - 1 + list.length) % list.length);
          return;
        }
        if (e.key === 'Tab' || e.key === 'Enter') {
          stop();
          acceptRef.current(selRef.current);
          return;
        }
        if (e.key === 'Escape') {
          stop();
          setSuggs([]);
          return;
        }
      }
      if (e.key === 'Enter') {
        stop();
        mf.blur();
        cbs.current.onEnter?.();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const at = caretContainer(mf);
      if (!at) return;
      const inScript = at.branch === 'superscript' || at.branch === 'subscript';
      if (e.key === ' ' && !inScript && (at.parentType === 'leftright' || at.parentType === 'root')) {
        // MathLive's Space jumps out of the enclosing bracket, so "(cos(t), sin(t))"
        // typed with a space after the comma closed the point early. In a bracket
        // (or at the top level) a space is just a separator, as in "k y". In an
        // exponent or subscript it still steps out (a_1 x).
        stop();
        mf.insert('\\,', { format: 'latex' });
        cbs.current.onChange(mf.value);
        return;
      }
      if (e.key === '(' && inScript && !at.empty && (at.parentType === 'mop' || at.parentType === 'operator')) {
        // sin^2(x), log_2(x): the bracket is the function's argument, not part of
        // the exponent / base.
        mf.executeCommand('moveAfterParent');
        return;
      }
      if ('=<>,:?'.includes(e.key) && e.key.length === 1) {
        // A relation, comma or colon never belongs in a denominator, exponent or
        // subscript: dy/dt=-y kept "=-y" in the denominator (\frac{dy}{dt=-y}),
        // a_1=3 made the subscript "1=3". Step out to the enclosing bracket first.
        for (let guard = 0; guard < 8; guard++) {
          const c = caretContainer(mf);
          if (!c || !SCRIPT_OR_FRACTION.has(c.branch ?? '')) break;
          mf.executeCommand('moveAfterParent');
        }
        return;
      }
      if (e.key === ')') {
        // e^(-x)sin(x): once the bracket that is the whole exponent is closed, the
        // exponent is done (otherwise sin(x) went up into it too).
        window.setTimeout(() => {
          const a = caretAtom(mf);
          if (
            a?.type === 'leftright' &&
            a.parentBranch === 'superscript' &&
            a.leftSibling?.type === 'first' &&
            a.isLastSibling
          ) {
            mf.executeCommand('moveAfterParent');
          }
        }, 0);
      }
    };
    mf.addEventListener('input', onInput);
    mf.addEventListener('focusin', onFocusIn);
    mf.addEventListener('focusout', onFocusOut);
    mf.addEventListener('keydown', onKey, true);
    return () => {
      mf.removeEventListener('input', onInput);
      mf.removeEventListener('focusin', onFocusIn);
      mf.removeEventListener('focusout', onFocusOut);
      mf.removeEventListener('keydown', onKey, true);
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
