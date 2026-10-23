import { describe, expect, it } from 'vitest';
import { parseEntry, parseLoops, loopValues, type Parsed } from './parse';
import { entryToLatex } from './tolatex';
import { latexToText } from './fromlatex';

type Kind<K extends Parsed['kind']> = Extract<Parsed, { kind: K }>;
function as<K extends Parsed['kind']>(p: Parsed, kind: K): Kind<K> {
  expect(p.kind).toBe(kind);
  return p as Kind<K>;
}

describe('parametric curves', () => {
  it('a point whose coordinates use t is parametric', () => {
    const p = as(parseEntry('(cos(t), sin(t))'), 'parametric');
    expect(p.deps).toEqual([]);
    expect(p.xNode.toString()).toBe('cos(t)');
  });
  it('collects free variables as deps', () => {
    const p = as(parseEntry('(a cos(t) + b, 2 sin(t))'), 'parametric');
    expect(p.deps.sort()).toEqual(['a', 'b']);
  });
  it('only one coordinate needs t', () => {
    expect(parseEntry('(t, 2)').kind).toBe('parametric');
    expect(parseEntry('(1, t^2)').kind).toBe('parametric');
  });
  it('plain points, polylines and arrays are unchanged', () => {
    expect(parseEntry('(2, 3)').kind).toBe('points');
    expect(parseEntry('(a, b)').kind).toBe('points');
    expect(parseEntry('((0,0),(1,1))').kind).toBe('points');
    expect(parseEntry('[(1,2),(3,4)]').kind).toBe('points');
  });
  it('renders to LaTeX that round-trips through the editor', () => {
    const p = parseEntry('(cos(t), 2 sin(t))');
    const tex = entryToLatex(p)!;
    expect(tex).toContain('\\left(');
    expect(parseEntry(latexToText(tex)).kind).toBe('parametric');
  });
});

describe('function definitions', () => {
  it('parses name, params and body deps', () => {
    const p = as(parseEntry('f(x, y) = a x + y^2'), 'fndef');
    expect(p.name).toBe('f');
    expect(p.params).toEqual(['x', 'y']);
    expect(p.deps).toEqual(['a']);
  });
  it('single-letter and multi-letter names', () => {
    expect(as(parseEntry('Tx(u) = 2u'), 'fndef').name).toBe('Tx');
    expect(as(parseEntry('g(t) = t^2'), 'fndef').params).toEqual(['t']);
  });
  it('requires t as a parameter if the body uses it', () => {
    const p = parseEntry('f(u) = u + t');
    expect(p.kind).toBe('error');
  });
  it('rejects recursion and duplicate params', () => {
    expect(parseEntry('f(u) = f(u - 1)').kind).toBe('error');
    expect(parseEntry('f(u, u) = u').kind).toBe('error');
  });
  it('does not hijack builtins, derivatives or y/r', () => {
    expect(parseEntry('sin(t) = y').kind).not.toBe('fndef');
    expect(parseEntry("y'(t) = 3").kind).not.toBe('fndef');
    expect(parseEntry('y(t) = 3').kind).not.toBe('fndef');
    expect(parseEntry('r = 2').kind).toBe('polar');
  });
  it('accepts a ternary body and keeps raw display for it', () => {
    const p = as(parseEntry('h(u) = u < 1 ? u : 2 - u'), 'fndef');
    expect(entryToLatex(p)).toBeNull();
  });
  it('round-trips through LaTeX', () => {
    const p = parseEntry('R(x, y) = x cos(a) - y sin(a)');
    const back = parseEntry(latexToText(entryToLatex(p)!));
    const f = as(back, 'fndef');
    expect(f.name).toBe('R');
    expect(f.params).toEqual(['x', 'y']);
  });
});

describe('repeat (for loops)', () => {
  it('wraps a parametric body', () => {
    const p = as(parseEntry('(cos(t) + k, sin(t)) for k = 0..2'), 'repeat');
    expect(p.body.kind).toBe('parametric');
    expect(p.loops).toHaveLength(1);
    expect(p.loops[0].name).toBe('k');
    expect(p.deps).toEqual([]);
  });
  it('loop bounds contribute deps; loop vars do not', () => {
    const p = as(parseEntry('y = k t + a for k = 1..n'), 'repeat');
    expect(p.deps.sort()).toEqual(['a', 'n']);
  });
  it('supports several loops, Desmos-style ranges and steps', () => {
    const p = as(parseEntry('(i, j) for i = [0...3], j = 1..9 step 2'), 'repeat');
    expect(p.loops.map((l) => l.name)).toEqual(['i', 'j']);
    expect(p.loops[1].step?.toString()).toBe('2');
  });
  it('can repeat inequalities (a union of regions)', () => {
    const p = as(parseEntry('(t - k)^2 + y^2 < 1 for k = 0..2'), 'repeat');
    expect(p.body.kind).toBe('inequality');
  });
  it('rejects un-repeatable bodies and bad loops', () => {
    expect(parseEntry('a = 2 for k = 0..2').kind).toBe('error');
    expect(parseEntry("y' = y for k = 0..2").kind).toBe('error');
    expect(parseEntry('y = k for t = 0..2').kind).toBe('error');
    expect(parseEntry('y = k for k = 0..2, k = 1..2').kind).toBe('error');
  });
  it('does not misread identifiers that merely start with "for"', () => {
    expect(parseEntry('forward = 2').kind).toBe('variable');
    expect(parseEntry('y = format * t').kind).toBe('function');
  });
  it('round-trips through LaTeX', () => {
    const p = parseEntry('y = k t for k = 1..3');
    const tex = entryToLatex(p)!;
    expect(tex).toContain('\\operatorname{for}');
    const back = as(parseEntry(latexToText(tex)), 'repeat');
    expect(back.body.kind).toBe('function');
    expect(back.loops[0].name).toBe('k');
  });
});

describe('loop helpers', () => {
  it('parseLoops reads ranges', () => {
    const [l] = parseLoops('k = 2..5');
    expect(l.from.toString()).toBe('2');
    expect(l.to.toString()).toBe('5');
    expect(() => parseLoops('k = 5')).toThrow();
    expect(() => parseLoops('')).toThrow();
  });
  it('loopValues is inclusive, supports steps, descending ranges and a cap', () => {
    expect(loopValues(0, 3)).toEqual([0, 1, 2, 3]);
    expect(loopValues(1, 9, 2)).toEqual([1, 3, 5, 7, 9]);
    expect(loopValues(3, 0)).toEqual([3, 2, 1, 0]);
    expect(loopValues(0, 1, 0.25)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(loopValues(0, 1e9, 1, 100)).toHaveLength(100);
    expect(loopValues(0, NaN)).toEqual([]);
    expect(loopValues(0, 3, 0)).toEqual([]);
  });
});

describe('frames', () => {
  it('parses an index expression with deps', () => {
    const p = as(parseEntry('frames(30 T)'), 'frames');
    expect(p.deps).toEqual(['T']);
  });
  it('defaults to frame 0', () => {
    expect(parseEntry('frames()').kind).toBe('frames');
  });
  it('renders LaTeX that round-trips', () => {
    const tex = entryToLatex(parseEntry('frames(n)'))!;
    expect(parseEntry(latexToText(tex)).kind).toBe('frames');
  });
});

describe('named values', () => {
  it('a named expression without t is a (derived) named function', () => {
    const p = as(parseEntry('b = 2a + 1'), 'function');
    expect(p.name).toBe('b');
    expect(p.deps).toEqual(['a']);
  });
  it('ternaries and comparisons are allowed in derived values', () => {
    const p = as(parseEntry('m = T < 1 ? 0 : 1'), 'function');
    expect(p.name).toBe('m');
    expect(p.deps).toEqual(['T']);
  });
  it('a named expression of t is a named function of t', () => {
    expect(as(parseEntry('f = sin(t)'), 'function').name).toBe('f');
  });
});

describe('existing kinds are unaffected', () => {
  it.each([
    ['y = sin(x)', 'function'],
    ["y'' = -y", 'ode'],
    ['a = 2', 'variable'],
    ['x^2 + y^2 = 4', 'implicit'],
    ['r = 2theta', 'polar'],
    ['y < sin(t)', 'inequality'],
    ['A = (1, 2)', 'pointvar'],
    ['b = 2a', 'function'],
  ])('%s → %s', (raw, kind) => {
    expect(parseEntry(raw).kind).toBe(kind);
  });
});

describe('parenthesised coordinates are not mistaken for points', () => {
  it('reads ((a)*cos(t), (a)*sin(t)) as a parametric curve', () => {
    for (const s of [
      '((0.5 + 0.1 sin(w))*cos(t), (0.5 + 0.1 sin(w))*sin(t))',
      '((1 + t)*cos(t), (1 + t)*sin(t))',
      '((2)*cos(t), (3)*sin(t))',
    ]) {
      expect(parseEntry(s).kind, s).toBe('parametric');
    }
  });

  it('still reads true point groups as points and polylines', () => {
    const one = parseEntry('((1)*2, (3)*4)');
    expect(one.kind).toBe('points');
    const poly = parseEntry('((0, 0), (1, 2), (3, 1))');
    expect(poly.kind).toBe('points');
    if (poly.kind === 'points') expect(poly.polyline).toBe(true);
    expect(parseEntry('((1, 2))').kind).toBe('points');
  });
});
