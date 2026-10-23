import { describe, expect, it } from 'vitest';
import {
  COLOR_NAMES,
  DEFAULT_FEATURES,
  DEFAULT_PROJECTIONS,
  DEFAULT_SIG_FIGS,
  DEFAULT_VIEWPORT,
  LIMITS,
  cleanExpr,
  evalConstant,
  graphToSpec,
  resolveColor,
  specToGraph,
  suggestKey,
  validateSpec,
  type FluxionSpec,
  type NormalizedSpec,
} from './spec';
import { PALETTE } from '../../utils/colors';
import { useStore } from '../../store/useStore';

function ok(input: unknown): NormalizedSpec {
  const r = validateSpec(input);
  if (!r.ok) throw new Error('expected valid spec, got ' + JSON.stringify(r.errors));
  return r.spec;
}
function errs(input: unknown) {
  const r = validateSpec(input);
  if (r.ok) throw new Error('expected errors for ' + JSON.stringify(input));
  return r.errors;
}
const msgs = (input: unknown) => errs(input).map((e) => `${e.path}: ${e.message}`).join('\n');

describe('defaults', () => {
  it('mirror the store defaults', () => {
    const s = useStore.getState();
    expect(DEFAULT_VIEWPORT).toEqual(s.viewport);
    expect(DEFAULT_FEATURES).toEqual(s.features);
    expect(DEFAULT_PROJECTIONS).toEqual(s.projections);
    expect(DEFAULT_SIG_FIGS).toBe(s.sigFigs);
  });
  it('colour names cover the palette in order', () => {
    expect(Object.values(COLOR_NAMES)).toEqual([...PALETTE]);
  });
});

describe('validateSpec — accepts', () => {
  it('the minimal spec', () => {
    const s = ok({ expressions: ['y = sin(x)'] });
    expect(s.expressions).toEqual([{ expr: 'y = sin(x)', hidden: false, color: PALETTE[0] }]);
    expect(s.viewport).toEqual(DEFAULT_VIEWPORT);
    expect(s.features).toEqual(DEFAULT_FEATURES);
    expect(s.projections).toEqual(DEFAULT_PROJECTIONS);
    expect(s.sigFigs).toBe(3);
    expect(s.version).toBe(1);
  });
  it('a bare array of expressions', () => {
    expect(ok(['y = x', 'y = -x']).expressions.map((e) => e.expr)).toEqual(['y = x', 'y = -x']);
  });
  it('$schema and version 1', () => {
    ok({ $schema: 'https://example.com/s.json', version: 1, expressions: [] });
  });
  it('every expression option', () => {
    const s = ok({
      expressions: [
        { expr: "y'' = -y", color: 'blue', t0: 0, ic: [1, 0] },
        { expr: 'k = 2', min: 0, max: 5, step: 0.5, anim: 'bounce', speed: 2 },
        { expr: 'r = 1 + cos(theta)', thetaMin: 0, thetaMax: '4*pi', hidden: true },
        { expr: '(1, 2)', label: 'P', labelDir: 'nw', pointSize: 8, drag: 'both', color: '#ABC' },
      ],
    });
    expect(s.expressions[0]).toEqual({ expr: "y'' = -y", color: PALETTE[1], hidden: false, t0: 0, ic: [1, 0] });
    expect(s.expressions[1]).toMatchObject({ min: 0, max: 5, step: 0.5, anim: 'bounce', speed: 2 });
    expect(s.expressions[2]).toMatchObject({ hidden: true, thetaMin: 0 });
    expect(s.expressions[2].thetaMax).toBeCloseTo(4 * Math.PI);
    expect(s.expressions[3]).toMatchObject({ label: 'P', labelDir: 'nw', pointSize: 8, drag: 'both', color: '#aabbcc' });
  });
  it('a scalar ic as a one-element array', () => {
    expect(ok({ expressions: [{ expr: "y' = y", ic: 2 }] }).expressions[0].ic).toEqual([2]);
  });
  it('constant expressions for numbers', () => {
    const s = ok({
      expressions: [{ expr: "y' = y", t0: '-pi/2', ic: ['sqrt(2)', '1e-3'] }],
      viewport: { xmin: '-2pi', xmax: '2*pi', ymin: -1.5, ymax: 'e' },
    });
    expect(s.expressions[0].t0).toBeCloseTo(-Math.PI / 2);
    expect(s.expressions[0].ic![0]).toBeCloseTo(Math.SQRT2);
    expect(s.viewport.tMin).toBeCloseTo(-2 * Math.PI);
    expect(s.viewport.yMax).toBeCloseTo(Math.E);
  });
  it('a partial viewport, keeping defaults for the rest', () => {
    expect(ok({ expressions: [], viewport: { xmin: -1, xmax: 1 } }).viewport).toEqual({
      tMin: -1,
      tMax: 1,
      yMin: -5,
      yMax: 5,
    });
    // One-sided past the default bound shifts the other side instead of failing.
    expect(ok({ expressions: [], viewport: { xmin: 100 } }).viewport).toMatchObject({ tMin: 100, tMax: 116 });
    expect(ok({ expressions: [], viewport: { ymax: -50 } }).viewport).toMatchObject({ yMin: -60, yMax: -50 });
  });
  it('features, panels and sigFigs', () => {
    const s = ok({
      expressions: ['k = 1'],
      features: { extrema: false, endpoints: true },
      panels: { right: false, bottom: true, sliceX: 2, sliceY: 'k' },
      sigFigs: 5,
    });
    expect(s.features).toEqual({ ...DEFAULT_FEATURES, extrema: false, endpoints: true });
    expect(s.projections).toEqual({ rightOpen: false, bottomOpen: true, sliceT: 2, sliceY: 1, sliceYExpr: 'k' });
    expect(s.sigFigs).toBe(5);
  });
  it('LaTeX, converting it with a warning', () => {
    const r = validateSpec({ expressions: ['y = \\frac{1}{x}', '\\sin(x)'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.expressions[0].expr).toBe('y = ((1)/(x))');
    expect(r.spec.expressions[1].expr).toBe('sin(x)');
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0].message).toMatch(/LaTeX/);
  });
  it('warns (not errors) on an empty expression list', () => {
    const r = validateSpec({ expressions: [] });
    expect(r.ok && r.warnings[0].message).toMatch(/empty/);
  });
});

describe('validateSpec — colours', () => {
  it('auto-assigns the palette in order, skipping explicit picks', () => {
    const s = ok({ expressions: ['y = 1', { expr: 'y = 2', color: 'red' }, 'y = 3', 'y = 4'] });
    expect(s.expressions.map((e) => e.color)).toEqual([PALETTE[1], PALETTE[0], PALETTE[2], PALETTE[3]]);
  });
  it('cycles once every palette colour is used', () => {
    const s = ok({ expressions: Array.from({ length: 10 }, (_, i) => `y = ${i}`) });
    expect(s.expressions[8].color).toBe(PALETTE[0]);
  });
  it('resolveColor', () => {
    expect(resolveColor('Teal')).toBe(PALETTE[7]);
    expect(resolveColor('#FFF')).toBe('#ffffff');
    expect(resolveColor('#12abEF')).toBe('#12abef');
    expect(resolveColor('rgb(1,2,3)')).toBeNull();
    expect(resolveColor('#12345')).toBeNull();
    expect(resolveColor('url(javascript:alert(1))')).toBeNull();
  });
});

describe('validateSpec — rejects with helpful errors', () => {
  it('non-objects', () => {
    expect(msgs(null)).toMatch(/JSON object/);
    expect(msgs('y = x')).toMatch(/JSON object/);
    expect(msgs(42)).toMatch(/JSON object/);
  });
  it('missing / wrong expressions', () => {
    expect(msgs({})).toMatch(/missing "expressions"/);
    expect(msgs({ expressions: 'y = x' })).toMatch(/expressions: must be an array/);
    expect(msgs({ expressions: [42] })).toMatch(/expressions\[0\]: must be a string/);
    expect(msgs({ expressions: [{ color: 'red' }] })).toMatch(/missing "expr"/);
    expect(msgs({ expressions: [{ expr: 3 }] })).toMatch(/"expr" must be a string/);
  });
  it('unknown keys with suggestions', () => {
    expect(msgs({ expressions: [], viewport: { xMin: -1 } })).toMatch(/did you mean "xmin"/);
    expect(msgs({ expressions: [], viewport: { tmin: -1 } })).toMatch(/did you mean "xmin"/);
    expect(msgs({ expressions: [{ expr: 'y=x', colour: 'red' }] })).toMatch(/did you mean "color"/);
    expect(msgs({ expressions: [{ expr: "y'=y", y0: 1 }] })).toMatch(/did you mean "ic"/);
    expect(msgs({ expressions: [{ expr: "y'=y", initialConditions: [1] }] })).toMatch(/did you mean "ic"/);
    expect(msgs({ exprs: ['y=x'] })).toMatch(/did you mean "expressions"/);
    expect(msgs({ expressions: [], features: { extremum: true } })).toMatch(/did you mean "extrema"/);
    expect(msgs({ expressions: [], banana: 1 })).toMatch(/unknown key "banana"\. Allowed:/);
  });
  it('bad numbers', () => {
    expect(msgs({ expressions: [{ expr: "y'=y", t0: 'abc' }] })).toMatch(/must be a constant, but "abc" uses abc/);
    expect(msgs({ expressions: [{ expr: "y'=y", t0: 't' }] })).toMatch(/uses t/);
    expect(msgs({ expressions: [{ expr: "y'=y", t0: NaN }] })).toMatch(/finite/);
    expect(msgs({ expressions: [{ expr: "y'=y", t0: true }] })).toMatch(/number or a constant/);
    expect(msgs({ expressions: [{ expr: "y'=y", t0: '1/0' }] })).toMatch(/finite/);
    expect(msgs({ expressions: [{ expr: "y'=y", t0: 'sqrt(-1)' }] })).toMatch(/finite real/);
    expect(msgs({ expressions: [{ expr: "y'=y", t0: 1e12 }] })).toMatch(/within/);
    expect(msgs({ expressions: [{ expr: "y'=y", t0: 'createUnit("foo")' }] })).toMatch(/unknown function createUnit/);
    expect(msgs({ expressions: [{ expr: "y'=y", ic: [1, 'x'] }] })).toMatch(/expressions\[0\]\.ic\[1\]/);
    expect(msgs({ expressions: [{ expr: "y'=y", ic: [] }] })).toMatch(/must not be empty/);
    expect(msgs({ expressions: [{ expr: "y'=y", ic: new Array(11).fill(0) }] })).toMatch(/at most 10/);
  });
  it('bad slider settings', () => {
    expect(msgs({ expressions: [{ expr: 'k=1', min: 5, max: 1 }] })).toMatch(/greater than min/);
    expect(msgs({ expressions: [{ expr: 'k=1', step: 0 }] })).toMatch(/> 0/);
    expect(msgs({ expressions: [{ expr: 'k=1', anim: 'spin' }] })).toMatch(/"loop", "bounce", "once"/);
    expect(msgs({ expressions: [{ expr: 'k=1', speed: 500 }] })).toMatch(/≤ 100/);
    expect(msgs({ expressions: [{ expr: 'k=1', speed: 0 }] })).toMatch(/≥ 0.0001/);
  });
  it('bad polar ranges (bounded so the region test stays cheap)', () => {
    expect(msgs({ expressions: [{ expr: 'r<2', thetaMin: 3, thetaMax: 1 }] })).toMatch(/greater than thetaMin/);
    expect(msgs({ expressions: [{ expr: 'r<2', thetaMax: 1000 }] })).toMatch(/50 turns/);
    expect(msgs({ expressions: [{ expr: 'r<2', thetaMax: 1e6 }] })).toMatch(/within/);
  });
  it('bad point options', () => {
    expect(msgs({ expressions: [{ expr: '(1,2)', labelDir: 'up' }] })).toMatch(/"n", "ne"/);
    expect(msgs({ expressions: [{ expr: '(1,2)', drag: 'yes' }] })).toMatch(/"auto", "off"/);
    expect(msgs({ expressions: [{ expr: '(1,2)', pointSize: 40 }] })).toMatch(/≤ 14/);
    expect(msgs({ expressions: [{ expr: '(1,2)', label: 7 }] })).toMatch(/label: must be a string/);
  });
  it('bad colours and booleans', () => {
    expect(msgs({ expressions: [{ expr: 'y=x', color: 'chartreuse' }] })).toMatch(/one of red, blue/);
    expect(msgs({ expressions: [{ expr: 'y=x', hidden: 'yes' }] })).toMatch(/true or false/);
    expect(msgs({ expressions: [], features: { extrema: 1 } })).toMatch(/features\.extrema: must be true or false/);
  });
  it('bad viewport', () => {
    expect(msgs({ expressions: [], viewport: { xmin: 5, xmax: 1 } })).toMatch(/xmax: must be greater than xmin/);
    expect(msgs({ expressions: [], viewport: { ymin: 0, ymax: 0 } })).toMatch(/ymax: must be greater/);
    expect(msgs({ expressions: [], viewport: [0, 1] })).toMatch(/viewport: must be an object/);
  });
  it('bad panels / sigFigs / version', () => {
    expect(msgs({ expressions: [], panels: { sliceX: '(((' } })).toMatch(/not a valid number or expression/);
    expect(msgs({ expressions: [], panels: { sliceX: 'evaluate("1")' } })).toMatch(/unknown function evaluate/);
    expect(msgs({ expressions: [], sigFigs: 40 })).toMatch(/≤ 12/);
    expect(msgs({ expressions: [], version: 2 })).toMatch(/newer than this Fluxion supports/);
    expect(msgs({ expressions: [], version: 'one' })).toMatch(/must be 1/);
  });
  it('size limits', () => {
    expect(msgs({ expressions: new Array(LIMITS.maxExpressions + 1).fill('y=x') })).toMatch(/too many expressions/);
    expect(msgs({ expressions: ['y=' + 'x+'.repeat(600) + 'x'] })).toMatch(/too long/);
    expect(msgs({ expressions: [{ expr: '(1,2)', label: 'x'.repeat(101) }] })).toMatch(/too long/);
    expect(msgs({ expressions: [{ expr: 'y=x', t0: '1+'.repeat(60) + '1' }] })).toMatch(/too long/);
  });
  it('reports every error at once, with paths', () => {
    const e = errs({ expressions: [{ expr: 'y=x', color: 'x' }, { expr: "y'=y", ic: 'q' }], sigFigs: 0 });
    expect(e.map((x) => x.path)).toEqual(['expressions[0].color', 'expressions[1].ic', 'sigFigs']);
  });
  it('ignores prototype-pollution style keys', () => {
    const input = JSON.parse('{"expressions":["y=x"],"__proto__":{"polluted":true}}');
    expect(msgs(input)).toMatch(/unknown key "__proto__"/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('helpers', () => {
  it('evalConstant', () => {
    expect(evalConstant(3)).toBe(3);
    expect(evalConstant('2pi')).toBeCloseTo(2 * Math.PI);
    expect(evalConstant('π/2')).toBeCloseTo(Math.PI / 2);
    expect(evalConstant('tau')).toBeCloseTo(2 * Math.PI);
    expect(evalConstant('')).toMatch(/empty/);
    expect(evalConstant('k')).toMatch(/uses k/);
  });
  it('suggestKey', () => {
    expect(suggestKey('XMIN', ['xmin', 'xmax'])).toBe('xmin');
    expect(suggestKey('colr', ['color'])).toBe('color');
    expect(suggestKey('zzzzzz', ['color'])).toBe('');
  });
  it('cleanExpr', () => {
    expect(cleanExpr('  y = x  ')).toEqual({ text: 'y = x', fromLatex: false });
    expect(cleanExpr('y = \\sqrt{x}').fromLatex).toBe(true);
  });
});

describe('specToGraph / graphToSpec', () => {
  it('maps every option onto Entry fields', () => {
    const g = specToGraph(
      ok({
        expressions: [
          { expr: "y'' = -y", t0: 1, ic: [1, 0] },
          { expr: 'k = 2', min: 0, max: 5, step: 0.5, anim: 'once', speed: 3 },
          { expr: 'r = theta', thetaMin: 0, thetaMax: 10, hidden: true },
          { expr: 'A = (1, 2)', label: 'A', labelDir: 's', pointSize: 9, drag: 'x' },
        ],
      }),
    );
    expect(g.v).toBe(1);
    expect(g.entries[0]).toEqual({
      id: 'api-1',
      raw: "y'' = -y",
      color: PALETTE[0],
      visible: true,
      expanded: true,
      t0: 1,
      ic: [1, 0],
    });
    expect(g.entries[1]).toMatchObject({ varMin: 0, varMax: 5, varStep: 0.5, animMode: 'once', animSpeed: 3 });
    expect(g.entries[2]).toMatchObject({ visible: false, thetaMin: 0, thetaMax: 10 });
    expect(g.entries[3]).toMatchObject({ pointLabel: 'A', pointLabelDir: 's', pointSize: 9, pointDrag: 'x' });
    expect(new Set(g.entries.map((e) => e.id)).size).toBe(4);
  });

  const roundTrip = (spec: FluxionSpec) => graphToSpec(specToGraph(ok(spec)));

  it('round-trips a minimal spec to itself', () => {
    expect(roundTrip({ expressions: ['y = sin(x)', "y' = y"] })).toEqual({
      version: 1,
      expressions: ['y = sin(x)', "y' = y"],
    });
  });
  it('round-trips a full spec (normalised)', () => {
    const spec: FluxionSpec = {
      version: 1,
      expressions: [
        { expr: "y'' = -y", t0: 1, ic: [1, 0] },
        { expr: 'k = 2', color: '#123456', min: 0, max: 5, step: 0.5, anim: 'once', speed: 3 },
        'y = k*x',
        { expr: 'r = theta', thetaMin: 0, thetaMax: 10, hidden: true },
        { expr: 'A = (1, 2)', label: 'A', labelDir: 's', pointSize: 9, drag: 'x' },
      ],
      viewport: { xmin: -1, xmax: 1, ymin: -2, ymax: 2 },
      features: { extrema: false },
      panels: { right: false, sliceY: 'k' },
      sigFigs: 6,
    };
    expect(roundTrip(spec)).toEqual(spec);
    // …and is stable on a second pass.
    expect(roundTrip(roundTrip(spec))).toEqual(spec);
  });
  it('folds a moved slider value back into its expression', () => {
    const g = specToGraph(ok({ expressions: ['k = 2'] }));
    g.entries[0].varValue = 3.5;
    expect(graphToSpec(g).expressions).toEqual(['k = 3.5']);
  });
  it('drops blank rows and keeps colours that differ from auto-assignment', () => {
    const g = specToGraph(ok({ expressions: ['y = 1', 'y = 2'] }));
    g.entries.unshift({ id: 'blank', raw: '  ', color: '#000000', visible: true, expanded: true });
    g.entries[2].color = '#C74440'; // same as entry 1 (case differs) → must be explicit
    const spec = graphToSpec(g);
    const back = specToGraph(ok(spec));
    expect(back.entries.map((e) => e.color)).toEqual([PALETTE[0], PALETTE[0]]);
  });
});
