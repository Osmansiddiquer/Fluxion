import { describe, expect, it } from 'vitest';
import { expandWhere, hasWhere, parseEntry } from './parse';
import { entryToLatex } from './tolatex';
import { computeAll } from '../compute';
import type { Entry, Viewport } from '../../store/types';

const vp: Viewport = { tMin: -8, tMax: 8, yMin: -5, yMax: 5 };
let n = 0;
const E = (raw: string, extra: Partial<Entry> = {}): Entry => ({
  id: `w${n++}`,
  raw,
  color: '#000',
  visible: true,
  expanded: false,
  ...extra,
});
const pts = (entries: Entry[], id: string) => computeAll(entries, vp, 400).get(id)!;

describe('where: local definitions', () => {
  it('expands locals, in order, as parenthesised sub-expressions', () => {
    expect(expandWhere('y = a*x^2 + a where a = 2 + 1')).toEqual({ text: 'y = (2 + 1)*x^2 + (2 + 1)' });
    expect(expandWhere('y = b where a = 2, b = 3a')).toEqual({ text: 'y = (3(2))' });
    expect(expandWhere('y = sin(x)')).toBeNull();
    // Only whole identifiers: `ab`, `a2`, `sinh` and an exponent like 1e5 are untouched.
    expect(expandWhere('y = ab + a2 + a + 1e5 where a = 7')).toEqual({ text: 'y = ab + a2 + (7) + 1e5' });
    // Implicit multiplication keeps working.
    expect(expandWhere('y = 2a where a = x')).toEqual({ text: 'y = 2(x)' });
  });

  it('a local may shadow a global of the same name (inner use refers to the global)', () => {
    const a = E('a = 3');
    const y = E('y = a where a = a*2');
    const r = pts([a, y], y.id);
    expect(r.error).toBeUndefined();
    expect(r.curve.segments[0][0][1]).toBeCloseTo(6);
  });

  it('gives the same curve as writing the expression out', () => {
    const T = E('T = 1.5');
    const long = E('(s*cos(t) + mod(T*0.4 + 3, 48) - 24, s*sin(t) + 0.3*mod(T*0.4 + 3, 48)/48) where s = 1 + 0.2*sin(3t)');
    const flat = E('((1 + 0.2*sin(3t))*cos(t) + mod(T*0.4 + 3, 48) - 24, (1 + 0.2*sin(3t))*sin(t) + 0.3*mod(T*0.4 + 3, 48)/48)');
    const res = computeAll([T, long, flat], { tMin: -30, tMax: 30, yMin: -20, yMax: 20 }, 400);
    expect(res.get(long.id)!.parsed.kind).toBe('parametric');
    expect(res.get(long.id)!.curve.segments).toEqual(res.get(flat.id)!.curve.segments);
  });

  it('works with for repeats, before or after the loop clause, and locals can use the loop variable', () => {
    const a = E('(cos(t) + d, sin(t)) where d = 3k for k = 0..2');
    const b = E('(cos(t) + d, sin(t)) for k = 0..2 where d = 3k');
    const ra = pts([a], a.id);
    const rb = pts([b], b.id);
    expect(ra.parsed.kind).toBe('repeat');
    expect(ra.copies).toBe(3);
    expect(rb.copies).toBe(3);
    expect(ra.curve.segments).toEqual(rb.curve.segments);
    expect(ra.curve.segments[2][0][0]).toBeCloseTo(7);
  });

  it('works across kinds: functions, ODEs, implicit, inequalities, points, user functions', () => {
    expect(parseEntry("y' = -k*y where k = 0.5").kind).toBe('ode');
    expect(parseEntry('x^2 + y^2 = R^2 where R = 2').kind).toBe('implicit');
    expect(parseEntry('y < h where h = sin(x)').kind).toBe('inequality');
    expect(parseEntry('((0, 0), (w, 0), (w, w)) where w = 2').kind).toBe('points');
    const f = parseEntry('f(u) = a*u where a = 3');
    expect(f.kind).toBe('fndef');
    const fe = E('f(u) = a*u where a = 3');
    const y = E('y = f(x)');
    expect(pts([fe, y], y.id).curve.segments[0][0][1]).toBeCloseTo(-24);
  });

  it('keeps the typed raw text and is shown as typed', () => {
    const raw = 'y = a*x where a = 2';
    const p = parseEntry(raw);
    expect(p.kind === 'function' && p.raw).toBe(raw);
    expect(hasWhere(raw)).toBe(true);
    expect(entryToLatex(p)).toBeNull();
    // `where` inside a name or brackets isn't a keyword.
    expect(hasWhere('y = somewhere + 1')).toBe(false);
  });

  it('reports mistakes clearly', () => {
    const msg = (raw: string) => {
      const p = parseEntry(raw);
      return p.kind === 'error' ? p.message : '';
    };
    expect(msg('where a = 1')).toMatch(/Nothing before/);
    expect(msg('y = a where')).toMatch(/Expected definitions/);
    expect(msg('y = a where a')).toMatch(/name = value/);
    expect(msg('y = a where a = 1, a = 2')).toMatch(/defined twice/);
    expect(msg('y = t where t = 1')).toMatch(/can't be called t/);
    expect(msg('y = a where a = b where b = 1')).toMatch(/Nested/);
  });

  it('a local used several times evaluates correctly (shared by CSE at run time)', () => {
    const T = E('T = 1');
    const g = E('g(u) = u');
    const y = E('y = s + s*s where s = g(sin(x) + T)');
    const ents = [T, g, y];
    const res = computeAll(ents, vp, 100);
    expect(res.get(y.id)!.error).toBeUndefined();
    const v = res.get(y.id)!.curve.segments[0][0];
    const s = Math.sin(v[0]) + 1;
    expect(v[1]).toBeCloseTo(s + s * s, 9);
  });
});
