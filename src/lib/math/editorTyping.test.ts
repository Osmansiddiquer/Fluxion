// Regression tests for bugs found by typing into the MathLive editor key by key
// (scripts/e2e-editor-typing.cjs drives the real editor). The LaTeX strings are
// the ones MathLive 0.110 actually emitted in the browser.
import { describe, expect, it } from 'vitest';
import { latexToText } from './fromlatex';
import { parseEntry } from './parse';
import { entryToLatex } from './tolatex';
import { absBars } from './normalize';
import { editorShortcuts, suggestionLatex } from './editorShortcuts';
import { computeAll } from '../compute';
import type { Entry } from '../../store/types';

const kind = (raw: string) => parseEntry(raw).kind;
const show = (raw: string) => entryToLatex(parseEntry(raw));
const roundTrip = (raw: string) => latexToText(show(raw)!);

describe('LaTeX from the editor → text', () => {
  it.each([
    // A bracket the user hasn't typed (or deleted) is the ghost MathLive draws.
    ['y=\\left(x\\right.', 'y=(x)'],
    ['y=\\left.x\\right)', 'y=(x)'],
    // |x| (smart fence) is abs.
    ['\\left|x\\right|', 'abs(x)'],
    ['y=\\left|x-1\\right|+\\left|x+1\\right|', 'y=abs(x-1)+abs(x+1)'],
    // Floor/ceil fences (pasted LaTeX).
    ['y=\\left\\lfloor x\\right\\rfloor+\\left\\lceil x\\right\\rceil', 'y=floor(x)+ceil(x)'],
    // Fractions and exponent braces don't double the user's brackets.
    ['y=\\frac{1}{\\left(x+1\\right)}', 'y=((1)/(x+1))'],
    ['\\left(\\frac{\\left(x+1\\right)}{\\left(x-1\\right)}\\right)', '((x+1)/(x-1))'],
    ['y=e^{\\left(-x^2\\right)}', 'y=e^(-x^2)'],
    // Old shortcut output still reads back.
    ['\\differentialD y', 'd y'],
    ['y=x\\bmod 3', 'y=x mod 3'],
    ['y=\\varepsilon x', 'y=epsilon x'],
    ['y=\\infty', 'y=Infinity'],
    // The thin space the editor's Space inserts is a separator.
    ['y=k\\,x', 'y=k x'],
    ['\\left(\\cos\\left(t\\right),\\,\\sin\\left(t\\right)\\right)', '(cos(t), sin(t))'],
    ['y=\\left\\lbrace x<0:\\,-x,\\,x\\right\\rbrace', 'y={ x<0: -x, x}'],
    // log_2(x) once ( leaves the base.
    ['y=\\log_2\\left(x\\right)', 'y=log(x, 2)'],
    ['\\frac{dy}{dt}=-y', '((dy)/(dt))=-y'],
  ])('%s → %s', (latex, text) => {
    expect(latexToText(latex)).toBe(text);
  });

  it('parses what the editor produced', () => {
    expect(kind(latexToText('\\frac{dy}{dt}=-y'))).toBe('ode');
    expect(kind(latexToText('y=\\left(x\\right.'))).toBe('function');
    expect(kind(latexToText('y=\\left|x\\right|+1'))).toBe('function');
    expect(kind(latexToText('\\left(\\cos\\left(t\\right),\\,\\sin\\left(t\\right)\\right)'))).toBe('parametric');
    expect(kind(latexToText('y=\\left\\lbrace x<0:\\,-x,\\,x\\right\\rbrace'))).toBe('function');
  });
});

describe('absolute-value bars in text', () => {
  it.each([
    ['y=|x|', 'y=abs(x)'],
    ['y=|x-1|+|x+1|', 'y=abs(x-1)+abs(x+1)'],
    ['y=2|x|', 'y=2abs(x)'],
    ['y=-|x|', 'y=-abs(x)'],
    // Lone bars and || stay (the "or" of a condition).
    ['x<0 | x>2', 'x<0 | x>2'],
    ['a || b', 'a || b'],
  ])('%s → %s', (a, b) => expect(absBars(a)).toBe(b));

  it('y = |x| is a function', () => expect(kind('y = |x|')).toBe('function'));
});

describe('display → editor round trip', () => {
  it('a list shows as typed, not a column vector', () => {
    expect(show('[1,2,3]')).toBe('y = \\left[1,2,3\\right]');
    expect(roundTrip('[1,2,3]')).toBe('y = [1,2,3]');
  });

  it('fractions show without the brackets the editor added', () => {
    expect(show('y=((1)/((x+1)))')).toBe(' y = \\frac{1}{{x}+1}');
  });

  it('a bracketed exponent shows raised, without brackets', () => {
    expect(show('y=e^((-x^2))')).toContain('^{-');
    expect(show('y=1*10^(-3)x')).toContain('{10}^{-3}');
  });

  it('x typed as the variable stays x (the next edit kept turning it into t)', () => {
    expect(show('y=sin(x)')).toBe(' y = \\sin\\left({x}\\right)');
    expect(roundTrip('y=sin(x)')).toBe('y = sin(x)');
    // t typed stays t.
    expect(show('y=sin(t)')).toBe(' y = \\sin\\left({t}\\right)');
  });
});

describe('editor shortcuts', () => {
  const defaults = {
    alpha: '\\alpha',
    sin: '\\sin',
    log: '\\log_{#?}',
    mod: '\\bmod{#?}',
    floor: '\\left\\lfloor#?\\right\\rfloor',
    nthroot: '\\sqrt[#?]{#?}',
    dx: { value: '\\differentialD x' },
    in: { value: '\\in' },
    "''": '^{\\doubleprime}',
    '<=': '\\le',
  };
  const sc = editorShortcuts(defaults);

  it('drops the ones that change what was typed', () => {
    for (const k of ['mod', 'floor', 'nthroot', 'dx', 'in']) expect(sc).not.toHaveProperty(k);
  });

  it('keeps Greek, operator names, primes and ≤, and log is plain', () => {
    expect(sc.alpha).toBe('\\alpha');
    expect(sc.sin).toBe('\\sin');
    expect(sc["''"]).toBe('^{\\doubleprime}');
    expect(sc['<=']).toBe('\\le');
    expect(sc.log).toBe('\\log');
    expect(sc.theta).toBe('\\theta');
  });

  it('accepted suggestions insert the symbol they name', () => {
    expect(suggestionLatex('sin')).toBe('\\sin');
    expect(suggestionLatex('alpha')).toBe('\\alpha');
    expect(suggestionLatex('sqrt')).toBe('\\sqrt{#?}');
    expect(suggestionLatex('floor')).toBe('\\operatorname{floor}');
    expect(suggestionLatex('amp')).toBe('amp');
    for (const s of ['sin', 'alpha', 'floor', 'amp']) {
      expect(latexToText(suggestionLatex(s))).toBe(s);
    }
  });
});

describe('brackets after something that is not a function multiply', () => {
  const V = { tMin: -5, tMax: 5, yMin: -5, yMax: 5 };
  const run = (...raws: string[]) => {
    const entries = raws.map(
      (raw, i) => ({ id: `e${i}`, raw, color: '#000', visible: true, expanded: false, ic: [0.5] }) as Entry,
    );
    const r = computeAll(entries, V, 200);
    return entries.map((e) => r.get(e.id)!);
  };
  const last = (c: { curve: { segments: [number, number][][] } }) => c.curve.segments[0].slice(-1)[0];

  it("logistic y' = y(1 − y) solves (was a solution-value error)", () => {
    const [r] = run("y'=y(1-y)");
    expect(r.error).toBeUndefined();
    expect(last(r)[1]).toBeCloseTo(1, 1);
  });

  it('x(x + 1) and a slider a(x + 1) are products', () => {
    expect(last(run('y=x(x+1)')[0])[1]).toBeCloseTo(30);
    expect(last(run('a=2', 'y=a(x+1)')[1])[1]).toBeCloseTo(12);
  });

  it('conditions on an ODE row stay calls', () => {
    const [r] = run("y''=-y, y(0)=1, y'(0)=0");
    expect(r.error).toBeUndefined();
  });

  it('user functions, solution values and unknown names keep their meaning', () => {
    expect(last(run('f(x)=x^2', 'y=f(x+1)')[1])[1]).toBeCloseTo(36);
    expect(run("y'=y", '(1, y(1))')[1].error).toBeUndefined();
    expect(run('y=q(2)')[0].error).toMatch(/Unknown function: q/);
    // A solution value inside an ODE is still refused.
    expect(run("y''=-y+y(1)")[0].error).toMatch(/solution value/);
  });
});
