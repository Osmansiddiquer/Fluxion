import { describe, expect, it } from 'vitest';
import { runHeadless } from './testkit';
import {
  API_NAMES,
  API_SIGNATURES,
  compileScript,
  ease,
  keyframes,
  mix,
  mul,
  apply,
  rand,
  range,
  hsv,
  rgb,
} from './runtime';
import { OP, usesClock, type DisplayItem } from './protocol';

const items = (code: string, o = {}) => {
  const r = runHeadless(code, o);
  if (r.error) throw new Error(r.error.message);
  return r.frame.items;
};
const only = (code: string, o = {}) => {
  const it = items(code, o);
  expect(it).toHaveLength(1);
  return it[0];
};

describe('compile', () => {
  it('every API name has a signature', () => {
    for (const n of API_NAMES) expect(API_SIGNATURES[n], n).toBeTruthy();
    expect(new Set(API_NAMES).size).toBe(API_NAMES.length);
  });
  it('reports syntax errors without throwing', () => {
    const c = compileScript('circle(0, 0,');
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error.message).toMatch(/SyntaxError/);
  });
  it('rejects scripts over the size cap', () => {
    const c = compileScript('x'.repeat(100_001));
    expect(c.ok).toBe(false);
  });
  it('is strict mode (no accidental globals)', () => {
    const r = runHeadless('oops = 3');
    expect(r.error?.message).toMatch(/oops/);
  });
  it('reports the line of a runtime error', () => {
    const r = runHeadless('circle(0, 0, 1)\n\nnotDefined()\n');
    expect(r.error?.line).toBe(3);
    expect(r.frame.items).toHaveLength(1); // drawn before the error
  });
  it('lets scripts declare names that shadow the API', () => {
    const r = runHeadless('const scale = 2, E = 3, view = 1, line = [0, 1]\nfunction text() { return 5 }\nprint(scale * E, view, line, text())\ncircle(0, 0, 1)');
    expect(r.error).toBeUndefined();
    expect(r.frame.logs[0]).toBe('6 1 [0,1] 5');
    expect(runHeadless('\n\nnope()').error?.line).toBe(3);
  });
  it('detects clock use', () => {
    expect(usesClock('circle(cos(time), 0, 1)')).toBe(true);
    expect(usesClock('const f = frame % 60')).toBe(true);
    expect(usesClock('// time\ncircle(0, 0, 1)')).toBe(false);
    expect(usesClock('text("time", 0, 0)')).toBe(false);
    expect(usesClock('text(`t=${time}`, 0, 0)')).toBe(true);
    expect(usesClock('const timeline = 1; obj.time')).toBe(false);
  });
});

describe('shapes', () => {
  it('circle → closed ellipse path in local coords with the current matrix', () => {
    const it = only('circle(1, 2, 3)') as Extract<DisplayItem, { k: 'path' }>;
    expect(it.k).toBe('path');
    expect(it.ops.slice(0, 5)).toEqual([OP.ellipse, 1, 2, 3, 3]);
    expect(it.ops[it.ops.length - 1]).toBe(OP.close);
    expect(it.m).toEqual([1, 0, 0, 1, 0, 0]);
    expect(it.style.stroke).toBeTruthy();
    expect(it.style.fill).toBeNull();
  });
  it('fill only → no outline; color + fill → both', () => {
    const a = only('circle(0, 0, 1, { fill: "red" })');
    expect(a.style.stroke).toBeNull();
    expect(a.style.fill).toBe('red');
    const b = only('circle(0, 0, 1, { fill: "red", color: "black", width: 4 })');
    expect(b.style).toMatchObject({ stroke: 'black', fill: 'red', width: 4 });
    const c = only('circle(0, 0, 1, { fill: true, color: "#123456" })');
    expect(c.style.fill).toBe('#123456');
  });
  it('dash presets and opacity', () => {
    expect(only('line(0, 0, 1, 1, { dash: "dashed" })').style.dash).toEqual([8, 6]);
    expect(only('line(0, 0, 1, 1, { dash: "dotted", opacity: 0.5 })').style).toMatchObject({ dash: [2, 5], opacity: 0.5 });
  });
  it('ellipse, arc, rect (+ rounded), polygon, polyline, line', () => {
    expect(only('ellipse(0, 0, 2, 1)').k).toBe('path');
    const arcIt = only('arc(0, 0, 1, 0, PI)') as Extract<DisplayItem, { k: 'path' }>;
    expect(arcIt.ops).toEqual([OP.ellipse, 0, 0, 1, 1, 0, 0, Math.PI, 0]);
    const r = only('rect(0, 0, 2, 1)') as Extract<DisplayItem, { k: 'path' }>;
    expect(r.ops).toEqual([OP.move, 0, 0, OP.line, 2, 0, OP.line, 2, 1, OP.line, 0, 1, OP.close]);
    const rr = only('rect(0, 0, 2, 1, { radius: 0.2 })') as Extract<DisplayItem, { k: 'path' }>;
    expect(rr.ops.filter((x, i) => i % 1 === 0 && x === OP.ellipse).length).toBeGreaterThanOrEqual(4);
    const pg = only('polygon([[0, 0], [1, 0], [0, 1]])') as Extract<DisplayItem, { k: 'path' }>;
    expect(pg.ops).toEqual([OP.move, 0, 0, OP.line, 1, 0, OP.line, 0, 1, OP.close]);
    const pl = only('polyline([{ x: 0, y: 0 }, { x: 1, y: 1 }])') as Extract<DisplayItem, { k: 'path' }>;
    expect(pl.ops).toEqual([OP.move, 0, 0, OP.line, 1, 1]);
    const flat = only('polyline([0, 0, 1, 1, 2, 0])') as Extract<DisplayItem, { k: 'path' }>;
    expect(flat.ops).toHaveLength(9);
  });
  it('NaN points break a polyline instead of failing', () => {
    const pl = only('polyline([[0, 0], [1, NaN], [2, 2], [3, 3]])') as Extract<DisplayItem, { k: 'path' }>;
    expect(pl.ops).toEqual([OP.move, 0, 0, OP.move, 2, 2, OP.line, 3, 3]);
    expect(items('circle(NaN, 0, 1)')).toHaveLength(0);
  });
  it('wrong argument types give a friendly error', () => {
    expect(runHeadless('circle("a", 0, 1)').error?.message).toMatch(/circle: x must be a number/);
    expect(runHeadless('circle(0, 0)').error?.message).toMatch(/circle: r must be a number \(got undefined\)/);
    expect(runHeadless('polygon(3)').error?.message).toMatch(/polygon: points must be a list/);
    expect(runHeadless('circle(0, 0, 1, "red")').error?.message).toMatch(/style like/);
  });
  it('point, arrow, text, label are positioned in data coords', () => {
    const p = only('translate(1, 1); point(1, 2, { size: 6, color: "red" })');
    expect(p).toMatchObject({ k: 'point', x: 2, y: 3, r: 6 });
    expect(p.style.fill).toBe('red');
    const a = only('arrow(0, 0, 1, 0, { head: 14 })');
    expect(a).toMatchObject({ k: 'arrow', x2: 1, head: 14 });
    const t = only('text("hi", 1, 2, { size: 20, bold: true })');
    expect(t).toMatchObject({ k: 'text', text: 'hi', x: 1, y: 2, size: 20, bold: true, halo: false, align: 'center' });
    const l = only('label("P", 0, 0)');
    expect(l).toMatchObject({ k: 'text', halo: true, align: 'left' });
    expect(only('text(1/3, 0, 0)')).toMatchObject({ text: '0.333333' });
  });
  it('path builder', () => {
    const p = only('path({ fill: "red" }).moveTo(0, 0).lineTo(1, 0).quadTo(1, 1, 0, 1).bezierTo(0, 2, 1, 2, 1, 3).arc(0, 0, 1, 0, 1).close()') as Extract<DisplayItem, { k: 'path' }>;
    expect(p.ops[0]).toBe(OP.move);
    expect(p.ops).toContain(OP.quad);
    expect(p.ops).toContain(OP.cubic);
    expect(p.ops).toContain(OP.ellipse);
    expect(p.ops[p.ops.length - 1]).toBe(OP.close);
    expect(items('path()')).toHaveLength(0); // empty paths dropped
    // lineTo first acts as moveTo
    expect((only('path().lineTo(1, 1).lineTo(2, 2)') as Extract<DisplayItem, { k: 'path' }>).ops[0]).toBe(OP.move);
  });
  it('curve and plot sample functions', () => {
    const c = only('curve(t => [cos(t), sin(t)], 0, TAU, { samples: 10 })') as Extract<DisplayItem, { k: 'path' }>;
    expect(c.ops.filter((_, i) => i % 3 === 0).length).toBe(11);
    const f = only('curve(t => [cos(t), sin(t)], 0, TAU, { fill: "red", samples: 10 })') as Extract<DisplayItem, { k: 'path' }>;
    expect(f.ops[f.ops.length - 1]).toBe(OP.close);
    const pl = only('plot(x => x * x, { samples: 16 })', { view: { xmin: -2, xmax: 2, ymin: -1, ymax: 3 } }) as Extract<DisplayItem, { k: 'path' }>;
    expect(pl.ops[1]).toBe(-2);
    expect(pl.ops[2]).toBe(4);
    expect(runHeadless('curve(3)').error?.message).toMatch(/function/);
  });
  it('background', () => {
    expect(runHeadless('background("#101418")').frame.background).toBe('#101418');
  });
});

describe('transforms', () => {
  it('mul / apply compose like canvas', () => {
    const t = mul([1, 0, 0, 1, 2, 3], [2, 0, 0, 2, 0, 0]);
    expect(apply(t, 1, 1)).toEqual([4, 5]);
  });
  it('push / pop / translate / rotate / scale', () => {
    const [a, b] = items('push(); translate(2, 0); rotate(PI / 2); circle(1, 0, 1); pop(); circle(0, 0, 1)') as Extract<DisplayItem, { k: 'path' }>[];
    const [x, y] = apply(a.m, 1, 0);
    expect(x).toBeCloseTo(2);
    expect(y).toBeCloseTo(1);
    expect(b.m).toEqual([1, 0, 0, 1, 0, 0]);
    const s = only('scale(2, 3); point(1, 1)');
    expect(s).toMatchObject({ x: 2, y: 3 });
    const r = only('rotate(PI, 1, 0); point(0, 0)');
    expect(r.k === 'point' && r.x).toBeCloseTo(2);
  });
  it('group({ translate, rotate, scale, origin }) restores afterwards', () => {
    const [a, b] = items('group({ translate: [1, 1], scale: 2 }, () => point(1, 0)); point(1, 0)');
    expect(a).toMatchObject({ x: 3, y: 1 });
    expect(b).toMatchObject({ x: 1, y: 0 });
    const [c] = items('group({ rotate: PI, origin: [1, 0] }, () => point(0, 0))');
    expect(c.k === 'point' && c.x).toBeCloseTo(2);
    // error inside a group still pops
    const r = runHeadless('try { group({ translate: [5, 5] }, () => { throw new Error("x") }) } catch {} point(0, 0)');
    expect(r.frame.items[0]).toMatchObject({ x: 0, y: 0 });
  });
  it('text rotates with the group', () => {
    const t = only('group({ rotate: 0.5 }, () => text("a", 0, 0))');
    expect(t.k === 'text' && t.angle).toBeCloseTo(0.5);
  });
});

describe('colour helpers', () => {
  it('rgb / hsv / hsl', () => {
    expect(rgb(255, 0, 0)).toBe('rgba(255, 0, 0, 1)');
    expect(hsv(120, 1, 1)).toBe('rgba(0, 255, 0, 1)');
    expect(runHeadless('print(hsl(240, 1, 0.5, 0.5))').frame.logs[0]).toBe('rgba(0, 0, 255, 0.5)');
  });
  it('mix and alpha accept hex, rgb() and hsv() strings', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('rgba(128, 128, 128, 1)');
    expect(mix('rgb(0, 0, 0)', hsv(0, 1, 1), 1)).toBe('rgba(255, 0, 0, 1)');
    expect(runHeadless('print(alpha("red", 0.25))').frame.logs[0]).toBe('rgba(255, 0, 0, 0.25)');
    expect(runHeadless('mix("banana", "red", 0.5)').error?.message).toMatch(/can't read colour/);
  });
  it('gradients become paints', () => {
    const it = only('circle(0, 0, 1, { fill: radialGradient(0, 0, 1, ["white", "red"]) })');
    expect(it.style.fill).toMatchObject({ type: 'radial', r1: 1, stops: [{ offset: 0, color: 'white' }, { offset: 1, color: 'red' }] });
    const lg = only('rect(0, 0, 1, 1, { fill: linearGradient(0, 0, 1, 0, [[0, "red"], [0.3, "blue"]]) })');
    expect(lg.style.fill).toMatchObject({ type: 'linear', stops: [{ offset: 0 }, { offset: 0.3 }] });
  });
});

describe('maths & animation helpers', () => {
  it('ease / range / rand / keyframes', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5);
    expect(ease(0.5, 'in')).toBeCloseTo(0.125);
    expect(range(3)).toEqual([0, 1, 2]);
    expect(range(1, 2, 0.5)).toEqual([1, 1.5]);
    expect(rand(3)).toBe(rand(3));
    expect(rand(3)).not.toBe(rand(4));
    expect(rand(7)).toBeGreaterThanOrEqual(0);
    expect(rand(7)).toBeLessThan(1);
    const k = [[0, 0], [2, 10], [4, 10]];
    expect(keyframes(-1, k)).toBe(0);
    expect(keyframes(1, k, { ease: 'linear' })).toBe(5);
    expect(keyframes(1, k)).toBe(5); // smooth is symmetric at the midpoint
    expect(keyframes(0.5, k) as number).toBeLessThan(2.5);
    expect(keyframes(9, k)).toBe(10);
    expect(keyframes(1, [[0, [0, 0]], [2, [2, 4]]], { ease: false })).toEqual([1, 2]);
    expect(keyframes(1, [[0, '#000000'], [2, '#ffffff']], { ease: false })).toBe('rgba(128, 128, 128, 1)');
  });
  it('maths globals', () => {
    const r = runHeadless('print(lerp(0, 10, 0.25), clamp(5), clamp(-1, 0, 2), smoothstep(0, 1, 0.5), map(5, 0, 10, 0, 1), mod(-1, 3), floor(PI), TAU / PI)');
    expect(r.frame.logs[0]).toBe('2.5 1 0 0.5 0.5 2 3 2');
  });
});

describe('3D', () => {
  it('project3d / camera', () => {
    const r = runHeadless('print(project3d([1, 2, 3]), project3d([1, 0, 0], { yaw: PI / 2, scale: 2 }))');
    expect(r.frame.logs[0]).toMatch(/^\[1,2\] \[/);
    const it = items('const cam = camera({ yaw: 0.3, pitch: 0.2, dist: 6 }); cam.line([0, 0, 0], [1, 1, 1]); cam.polygon([[0, 0, 0], [1, 0, 0], [0, 1, 0]]); cam.point([0, 0, 1]); print(cam.depth([0, 0, 1]) > cam.depth([0, 0, -1]))');
    expect(it.map((x) => x.k)).toEqual(['path', 'path', 'point']);
    expect(runHeadless('print(camera().depth([0,0,1]) > 0)').frame.logs[0]).toBe('true');
  });
});

describe('clock and inputs', () => {
  it('time and frame', () => {
    const r = runHeadless('print(time, frame)', { time: 1.5 });
    expect(r.frame.logs[0]).toBe('1.5 90');
    expect(r.frame.animated).toBe(true);
    expect(runHeadless('circle(0, 0, 1)').frame.animated).toBe(false);
  });
  it('loop(seconds) sets the loop length and marks the script animated', () => {
    const r = runHeadless('loop(4)');
    expect(r.frame.loop).toBe(4);
    expect(r.frame.animated).toBe(true);
    expect(runHeadless('loop(-1)').error?.message).toMatch(/positive/);
  });
  it('slider declares controls and reads their values', () => {
    const r = runHeadless('const k = slider("k", 0, 10, 3); const j = slider("j", -1, 1); print(k, j)');
    expect(r.frame.sliders).toEqual([
      { name: 'k', min: 0, max: 10, value: 3, step: 0 },
      { name: 'j', min: -1, max: 1, value: -1, step: 0 },
    ]);
    expect(r.frame.logs[0]).toBe('3 -1');
    expect(runHeadless('print(slider("k", 0, 10, 3))', { sliders: { k: 7 } }).frame.logs[0]).toBe('7');
    expect(runHeadless('print(slider("k", 0, 10, 3))', { sliders: { k: 70 } }).frame.logs[0]).toBe('10');
    expect(runHeadless('slider("k", 5, 1)').error?.message).toMatch(/max must be bigger/);
    expect(runHeadless('slider("bad-name!", 0, 1)').error?.message).toMatch(/short word/);
  });
});

describe('grapher interop', () => {
  const pend = [
    { raw: "theta'' = -sin(theta)", visible: true, ic: [1, 0] },
    { raw: 'k = 2.5', visible: true, varValue: 3 },
    { raw: 'f(u) = u^2 + k', visible: true },
    { raw: 'g = sin(t)', visible: true },
  ];
  it('graph.value reads slider values (the live one)', () => {
    expect(runHeadless('print(graph.value("k"))', { entries: pend }).frame.logs[0]).toBe('3');
    expect(runHeadless('graph.value("nope")', { entries: pend }).error?.message).toMatch(/no slider or value called nope/);
  });
  it('graph.fn calls user functions and named functions of t', () => {
    expect(runHeadless('print(graph.fn("f")(2))', { entries: pend }).frame.logs[0]).toBe('7');
    expect(runHeadless('print(graph.fn("g")(PI / 2))', { entries: pend }).frame.logs[0]).toBe('1');
    expect(runHeadless('graph.fn("h")', { entries: pend }).error?.message).toMatch(/no function called h/);
  });
  it('graph.ode solves on demand, matching a small-angle pendulum', () => {
    const small = [{ raw: "y'' = -y", visible: true, ic: [1, 0] }];
    const r = runHeadless('const y = graph.ode("y"), v = graph.ode("y", 1); print(y(0), y(PI), y(2 * PI), v(PI / 2), y(-PI / 2))', { entries: small });
    const [a, b, c, d, e] = r.frame.logs[0].split(' ').map(Number);
    expect(a).toBeCloseTo(1, 6);
    expect(b).toBeCloseTo(-1, 4);
    expect(c).toBeCloseTo(1, 4);
    expect(d).toBeCloseTo(-1, 4);
    expect(e).toBeCloseTo(0, 4);
    const big = runHeadless('const th = graph.ode("theta"); print(th(0), th(50) <= 1 && th(50) >= -1)', { entries: pend });
    expect(big.frame.logs[0]).toBe('1 true');
    expect(runHeadless('graph.ode("zz")', { entries: pend }).error?.message).toMatch(/no differential equation/);
    expect(runHeadless('print(graph.ode("y")(1e9))', { entries: small }).frame.logs[0]).toBe('NaN');
  });
  it('coupled systems: either component', () => {
    const sys = [
      { raw: "x' = y", visible: true, ic: [1] },
      { raw: "y' = -x", visible: true, ic: [0] },
    ];
    const r = runHeadless('print(graph.ode("x")(PI / 2), graph.ode("y")(PI / 2))', { entries: sys });
    const [x, y] = r.frame.logs[0].split(' ').map(Number);
    expect(x).toBeCloseTo(0, 4);
    expect(y).toBeCloseTo(-1, 4);
  });
  it('graph.names / graph.has', () => {
    const r = runHeadless('print(graph.names().sort().join(","), graph.has("k"), graph.has("q"))', { entries: pend });
    expect(r.frame.logs[0]).toBe('f,g,k,theta true false');
  });
});

describe('clips', () => {
  const clips = [{ name: 'apple', id: 'fx0123abcd1a', frames: 10, fps: 5, box: [-4, -3, 4, 3] as [number, number, number, number] }];
  it('clip(name) exposes metadata and draws a frame reference', () => {
    const r = runHeadless('const c = clip("apple"); print(c.frames, c.fps, c.duration, c.frameAt(1.1)); c.draw(12, { width: 4 })', { clips });
    expect(r.error).toBeUndefined();
    expect(r.frame.logs[0]).toBe('10 5 2 5');
    const it = r.frame.items[0];
    expect(it).toMatchObject({ k: 'clip', id: 'fx0123abcd1a', frame: 2 });
    if (it.k === 'clip') {
      expect(apply(it.m, 4, 3)).toEqual([2, 1.5]); // box corner → half size
      expect(it.style.fill).toBeTruthy();
    }
  });
  it('clip.play() follows the clock', () => {
    const r = runHeadless('clip("apple").play({ x: 1, y: 0 })', { clips, time: 0.5 });
    expect(r.frame.animated).toBe(true);
    expect(r.frame.items[0]).toMatchObject({ frame: 2 });
  });
  it('unknown clip names say what exists', () => {
    expect(runHeadless('clip("pear")', { clips }).error?.message).toMatch(/you have "apple"/);
    expect(runHeadless('clip("pear")').error?.message).toMatch(/import one/);
  });
});

describe('limits', () => {
  it('stops at the shape cap with a helpful message', () => {
    const r = runHeadless('for (let i = 0; i < 30000; i++) point(i % 10, 0)');
    expect(r.error?.message).toMatch(/Too many shapes/);
  });
  it('stops at the point cap', () => {
    const r = runHeadless('for (let i = 0; i < 400; i++) curve(t => [t, t], 0, 1, { samples: 5000 })');
    expect(r.error?.message).toMatch(/Too many points/);
  });
  it('console output is captured and capped', () => {
    const r = runHeadless('for (let i = 0; i < 500; i++) console.log("line", i)');
    expect(r.frame.logs).toHaveLength(100);
    expect(r.frame.logs[0]).toBe('line 0');
    expect(runHeadless('print({ a: 1 / 3, b: [1, 2] })').frame.logs[0]).toBe('{"a":0.33333333,"b":[1,2]}');
  });
  it('a script cannot see host globals it was not given', () => {
    // In the sandbox these are absent or blocked; here we check the API object
    // doesn't hand them over.
    expect(API_NAMES).not.toContain('fetch' as never);
    expect(API_NAMES).not.toContain('self' as never);
  });
});
