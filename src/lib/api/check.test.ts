import { describe, expect, it } from 'vitest';
import { checkSpec } from './check';

const kinds = (exprs: unknown[]) => checkSpec({ expressions: exprs }).expressions.map((e) => e.kind);

describe('checkSpec', () => {
  it('reports the kind and a summary for each expression', () => {
    const r = checkSpec({
      expressions: ['y = sin(x)', "y'' = -y", 'k = 2', 'x^2 + y^2 = 9', 'r = 1 + cos(theta)', 'y < x', '(1, 2)'],
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.expressions.map((e) => [e.kind, e.summary])).toEqual([
      ['function', 'function y(x)'],
      ['ode', '2nd-order ODE in y(t)'],
      ['variable', 'slider k = 2'],
      ['implicit', 'implicit curve F(x, y) = 0'],
      ['polar', 'polar curve r(θ)'],
      ['inequality', 'shaded region'],
      ['points', '1 point'],
    ]);
    expect(r.expressions.filter((e) => e.kind !== 'variable').every((e) => e.visible)).toBe(true);
    expect(r.spec?.expressions).toHaveLength(7);
  });

  it('passes structural errors through without running the parser', () => {
    const r = checkSpec({ expressions: [{ expr: 'y = x', colour: 'red' }] });
    expect(r.ok).toBe(false);
    expect(r.expressions).toEqual([]);
    expect(r.errors[0].message).toMatch(/did you mean "color"/);
  });

  it('flags parse errors', () => {
    const r = checkSpec({ expressions: ['y = sin(x'] });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ path: 'expressions[0]' });
    expect(r.errors[0].message).toMatch(/cannot parse/);
  });

  it('flags unknown functions, suggesting a definition (user functions are supported)', () => {
    const r = checkSpec({ expressions: ['f(x) = x^2', 'y = foo(x)', 'y = f(x) + 1'] });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.path)).toEqual(['expressions[1]']);
    expect(r.errors[0].message).toMatch(/unknown function foo.*define it/);
    expect(r.expressions[0]).toMatchObject({ kind: 'fndef', summary: 'function definition f(x)' });
  });

  it('accepts the scripting syntax and style options without warnings', () => {
    const r = checkSpec({
      expressions: [
        { expr: 'a = 0', min: 0, max: '2pi', anim: 'loop', speed: 0.01, autoplay: true },
        'g(u, v) = u*cos(v)',
        'b = 2a + 1',
        { expr: '(g(2, t), sin(t))', thetaMin: 0, thetaMax: 'pi', fill: true, lineWidth: 0, colorExpr: 'hsv(360*a, 0.8, 1)' },
        { expr: '(k, b) for k = -2..2', lineStyle: 'dotted', fillColor: '#ff0000' },
        { expr: 'y = keys(a, 0, 0, 1, 2) * x', colorExpr: 'rgba(0, 0, 0, clamp(a))' },
      ],
      features: { grid: false },
    });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.expressions.map((e) => e.kind)).toEqual(['variable', 'fndef', 'function', 'parametric', 'repeat', 'function']);
    expect(r.expressions[2].summary).toBe('derived value b');
    expect(r.spec!.features.grid).toBe(false);
  });

  it('rejects bad style options and colour expressions calling undefined functions', () => {
    const bad = checkSpec({
      expressions: [{ expr: 'y = x', lineWidth: 50, lineStyle: 'wavy', colorExpr: 'not a colour(' }],
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors.map((e) => e.path).sort()).toEqual(
      ['expressions[0].colorExpr', 'expressions[0].lineStyle', 'expressions[0].lineWidth'].sort(),
    );
    const undef = checkSpec({ expressions: [{ expr: 'y = x', colorExpr: 'hsv(huey(1), 1, 1)' }] });
    expect(undef.errors[0]).toMatchObject({ path: 'expressions[0].colorExpr' });
    expect(undef.errors[0].message).toMatch(/unknown function huey/);
  });

  it('warns when autoplay or the t-range is set where it does not apply', () => {
    const r = checkSpec({ expressions: [{ expr: 'y = x', autoplay: true, thetaMax: 1 }] });
    expect(r.warnings.map((w) => w.message).join(' ')).toMatch(/autoplay.*sliders/);
    expect(r.warnings.map((w) => w.message).join(' ')).toMatch(/thetaMin\/thetaMax/);
  });

  it('flags undefined variables with a slider hint', () => {
    const r = checkSpec({ expressions: ['y = a*x^2 + b'] });
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/undefined variables a, b.*"a = 1"/);
    expect(checkSpec({ expressions: ['y = a*x^2 + b', 'a = 1', 'b = -2'] }).ok).toBe(true);
  });

  it('reads x as the independent variable of an x-only ODE, and explains mixing x and t', () => {
    expect(checkSpec({ expressions: ["y' = x*y"] }).ok).toBe(true);
    expect(checkSpec({ expressions: ['dy/dx = x*y'] }).ok).toBe(true);
    expect(checkSpec({ expressions: ["y' = t*y"] }).ok).toBe(true);
    const r = checkSpec({ expressions: ["y' = x*t*y"] });
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/also uses t/);
  });

  it('catches the implicit-multiplication pitfalls documented in llms.txt', () => {
    // πx is one symbol "pix". x(1-x) inside x's own equation multiplies (Desmos-style).
    expect(checkSpec({ expressions: ['y = sin(πx)'] }).ok).toBe(false);
    expect(checkSpec({ expressions: ['y = sin(pi*x)'] }).ok).toBe(true);
    expect(checkSpec({ expressions: ["x' = x(1 - x)"] }).ok).toBe(true);
    expect(checkSpec({ expressions: ["y = q(2)"] }).ok).toBe(false);
    expect(checkSpec({ expressions: ["x' = x*(1 - x)"] }).ok).toBe(true);
  });

  it('accepts coupled systems written as separate expressions', () => {
    const r = checkSpec({ expressions: [{ expr: "x' = -y", ic: 1 }, { expr: "y' = x", ic: 0 }] });
    expect(r.ok).toBe(true);
    expect(r.expressions.map((e) => e.summary)).toEqual(['1st-order ODE in x(t)', '1st-order ODE in y(t)']);
  });

  it('warns about options that do not apply to the expression kind', () => {
    const r = checkSpec({
      expressions: [
        { expr: 'y = x', ic: [1], min: 0, thetaMax: 3, label: 'L' },
        { expr: 'k = 1', t0: 0 },
      ],
    });
    expect(r.ok).toBe(true);
    const m = r.warnings.map((w) => `${w.path} ${w.message}`);
    expect(m.some((s) => /\[0\] t0\/ic only apply to ODEs/.test(s))).toBe(true);
    expect(m.some((s) => /\[0\] min\/max\/step only apply to sliders/.test(s))).toBe(true);
    expect(m.some((s) => /\[0\] thetaMin\/thetaMax only apply to polar/.test(s))).toBe(true);
    expect(m.some((s) => /\[0\] label.* only apply to points/.test(s))).toBe(true);
    expect(m.some((s) => /\[1\] t0\/ic only apply to ODEs/.test(s))).toBe(true);
  });

  it('accepts θ options on polar regions, ic on ODEs, point options on point variables', () => {
    const r = checkSpec({
      expressions: [
        { expr: 'r < 2*theta', thetaMax: '4pi' },
        { expr: "y'' = -y", ic: [0, 1] },
        { expr: 'A = (1, 1)', label: 'A' },
      ],
      viewport: { xmin: -30, xmax: 30, ymin: -30, ymax: 30 },
    });
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('warns when ic has more values than the ODE order', () => {
    const r = checkSpec({ expressions: [{ expr: "y' = -y", ic: [1, 2] }] });
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatchObject({ path: 'expressions[0].ic' });
    expect(r.warnings[0].message).toMatch(/1st order/);
  });

  it('warns when a slider value is outside its bounds', () => {
    const r = checkSpec({ expressions: [{ expr: 'k = 9', min: 0, max: 5 }] });
    expect(r.warnings[0].message).toMatch(/outside/);
  });

  it('warns when something draws nothing in the viewport', () => {
    const r = checkSpec({ expressions: ['y = x + 100', '(50, 50)', 'x^2 + y^2 = 0.0000001 - 1'] });
    expect(r.ok).toBe(true);
    expect(r.expressions.map((e) => e.visible)).toEqual([false, false, false]);
    expect(r.warnings).toHaveLength(3);
    expect(r.warnings[0].message).toMatch(/widen the viewport/);
    expect(checkSpec({ expressions: ['y = x + 100'], viewport: { ymin: 90, ymax: 110 } }).warnings).toEqual([]);
  });

  it('warns when the y-range cannot be honoured because of the square grid', () => {
    const r = checkSpec({ expressions: ["P' = 0.5*P*(1 - P/1000)"], viewport: { xmin: 0, xmax: 20, ymin: 0, ymax: 1000 } });
    const w = r.warnings.find((x) => x.path === 'viewport');
    expect(w?.message).toMatch(/same scale.*about 15 units centred on 500/);
    expect(checkSpec({ expressions: ['y=x'], viewport: { xmin: 0, xmax: 20, ymin: -7, ymax: 7 } }).warnings).toEqual([]);
    // No y-range requested → nothing to warn about.
    expect(checkSpec({ expressions: ['y=x'], viewport: { xmin: 0, xmax: 2 } }).warnings).toEqual([]);
    expect(checkSpec({ expressions: ['y=x'], viewport: { xmin: -100, xmax: 100, ymin: -1, ymax: 1 } }).warnings[0].path).toBe('viewport');
  });

  it('detects visible shaded regions even when no boundary is inside', () => {
    const r = checkSpec({ expressions: ['y < 1000'] });
    expect(r.expressions[0].visible).toBe(true);
  });

  it('does not report visibility for hidden expressions', () => {
    const r = checkSpec({ expressions: [{ expr: 'y = x + 100', hidden: true }] });
    expect(r.warnings).toEqual([]);
    expect(r.expressions[0].visible).toBeUndefined();
  });

  it('never throws on hostile input', () => {
    for (const bad of [undefined, null, 1, 'x', [], [null], { expressions: [{}] }, { expressions: [[1]] }]) {
      expect(() => checkSpec(bad)).not.toThrow();
    }
  });

  it('classifies the documented kinds', () => {
    expect(kinds(['sin(x)', 'dy/dt = -y', 'u = 3', 'x = 2', 'r < 2', '1 < y < 2', '[(1,2),(3,4)]'])).toEqual([
      'function',
      'ode',
      'variable',
      'implicit',
      'inequality',
      'inequality',
      'points',
    ]);
  });
});
