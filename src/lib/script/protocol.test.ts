import { describe, expect, it } from 'vitest';
import { SCRIPT_LIMITS, parseRuntimeMessage, safeColor, sanitizeError, sanitizeFrame } from './protocol';

const base = { items: [], sliders: [], logs: [], background: null, loop: null, ms: 1, animated: false };
const style = { stroke: '#000', fill: null, width: 2, dash: [], opacity: 1, cap: 'round', join: 'round' };
const ok = (frame: unknown) => {
  const r = sanitizeFrame(frame);
  if (!r.ok) throw new Error(r.error);
  return r.frame;
};
const bad = (frame: unknown) => {
  const r = sanitizeFrame(frame);
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.error;
};

describe('sanitizeFrame', () => {
  it('accepts a well-formed frame and copies only known fields', () => {
    const f = ok({
      ...base,
      extra: 'dropped',
      items: [
        { k: 'path', ops: [0, 1, 2, 1, 3, 4, 4], m: [1, 0, 0, 1, 0, 0], style: { ...style, evil: () => 1 }, junk: 1 },
        { k: 'point', x: 1, y: 2, r: 5, style },
        { k: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1, head: 9, style },
        { k: 'text', x: 0, y: 0, text: 'hi', size: 14, align: 'center', baseline: 'middle', font: 'mono', bold: true, angle: 0, halo: false, style },
        { k: 'clip', id: 'fx0123abcd1a', frame: 3.7, m: [1, 0, 0, 1, 0, 0], style },
      ],
    });
    expect(f.items).toHaveLength(5);
    expect(Object.keys(f.items[0])).toEqual(['k', 'ops', 'm', 'style']);
    expect(Object.keys(f.items[0].style).sort()).toEqual(['cap', 'dash', 'fill', 'join', 'opacity', 'stroke', 'width']);
    expect(f.items[4]).toMatchObject({ frame: 3 });
    expect('extra' in f).toBe(false);
  });
  it('rejects non-finite or huge coordinates', () => {
    expect(bad({ ...base, items: [{ k: 'point', x: NaN, y: 0, style }] })).toMatch(/bad number/);
    expect(bad({ ...base, items: [{ k: 'point', x: 1e12, y: 0, style }] })).toMatch(/bad number/);
    expect(bad({ ...base, items: [{ k: 'point', x: '1', y: 0, style }] })).toMatch(/bad number/);
    expect(bad({ ...base, items: [{ k: 'path', ops: [0, 1, Infinity], m: [1, 0, 0, 1, 0, 0], style }] })).toMatch(/bad number/);
  });
  it('rejects malformed paths', () => {
    expect(bad({ ...base, items: [{ k: 'path', ops: [9, 1, 2], m: [1, 0, 0, 1, 0, 0], style }] })).toMatch(/bad path op/);
    expect(bad({ ...base, items: [{ k: 'path', ops: [1, 1], m: [1, 0, 0, 1, 0, 0], style }] })).toMatch(/truncated/);
    expect(bad({ ...base, items: [{ k: 'path', ops: [0, 1, 2], m: [1, 0, 0], style }] })).toMatch(/matrix/);
    expect(bad({ ...base, items: [{ k: 'path', ops: 'M0 0', m: [1, 0, 0, 1, 0, 0], style }] })).toMatch(/bad path/);
  });
  it('rejects unknown kinds and bad clip ids', () => {
    expect(bad({ ...base, items: [{ k: 'script', src: 'x' }] })).toMatch(/unknown item/);
    expect(bad({ ...base, items: [{ k: 'clip', id: '../../etc', frame: 0, m: [1, 0, 0, 1, 0, 0], style }] })).toMatch(/clip id/);
    expect(bad({ ...base, items: [null] })).toMatch(/bad item/);
    expect(bad('nope')).toMatch(/not an object/);
    expect(bad({})).toMatch(/no items/);
  });
  it('caps item counts and total geometry', () => {
    const many = Array.from({ length: SCRIPT_LIMITS.maxItems + 1 }, () => ({ k: 'point', x: 0, y: 0, style }));
    expect(bad({ ...base, items: many })).toMatch(/too many shapes/);
    const big = { k: 'path', ops: new Array(SCRIPT_LIMITS.maxNumbers + 3).fill(0).map((_, i) => (i % 3 === 0 ? 1 : 0)), m: [1, 0, 0, 1, 0, 0], style };
    big.ops[0] = 0;
    expect(bad({ ...base, items: [big] })).toMatch(/too much geometry/);
  });
  it('clamps style numbers and drops unsafe colours', () => {
    const f = ok({
      ...base,
      items: [{ k: 'point', x: 0, y: 0, r: 1e6, style: { stroke: 'url(javascript:alert(1))', fill: 'red', width: -5, dash: [1, 'x', 3, 4, 5, 6, 7, 8, 9, 10], opacity: 7, cap: 'evil' } }],
    });
    const it = f.items[0];
    expect(it.k === 'point' && it.r).toBe(SCRIPT_LIMITS.maxPx);
    expect(it.style).toMatchObject({ stroke: null, fill: 'red', width: 0, opacity: 1, cap: 'round' });
    expect(it.style.dash).toHaveLength(SCRIPT_LIMITS.maxDash);
  });
  it('caps text, logs and sliders; drops bad sliders', () => {
    const f = ok({
      ...base,
      items: [{ k: 'text', x: 0, y: 0, text: 'a\u0000b' + 'x'.repeat(1000), style }],
      logs: Array.from({ length: 500 }, () => 'y'.repeat(5000)),
      sliders: [
        { name: 'k', min: 0, max: 1, value: 5 },
        { name: 'k', min: 0, max: 9, value: 1 },
        { name: '<img>', min: 0, max: 1 },
        { name: 'z', min: 2, max: 1 },
        ...Array.from({ length: 40 }, (_, i) => ({ name: `s${i}`, min: 0, max: 1 })),
      ],
    });
    const t = f.items[0];
    expect(t.k === 'text' && t.text.length).toBe(SCRIPT_LIMITS.maxText);
    expect(t.k === 'text' && t.text.startsWith('a b')).toBe(true);
    expect(f.logs).toHaveLength(SCRIPT_LIMITS.maxLogs);
    expect(f.logs[0]).toHaveLength(SCRIPT_LIMITS.maxLogLine);
    expect(f.sliders[0]).toEqual({ name: 'k', min: 0, max: 1, value: 1, step: 0 });
    expect(f.sliders.some((s) => s.name === '<img>' || s.name === 'z')).toBe(false);
    expect(f.sliders.length).toBeLessThanOrEqual(SCRIPT_LIMITS.maxSliders);
  });
  it('gradients: validated stops, otherwise dropped', () => {
    const f = ok({
      ...base,
      items: [
        { k: 'point', x: 0, y: 0, style: { ...style, fill: { type: 'linear', x0: 0, y0: 0, x1: 1, y1: 0, stops: [{ offset: 2, color: 'red' }] } } },
        { k: 'point', x: 0, y: 0, style: { ...style, fill: { type: 'pattern', src: 'x' } } },
      ],
    });
    expect(f.items[0].style.fill).toMatchObject({ type: 'linear', stops: [{ offset: 1, color: 'red' }] });
    expect(f.items[1].style.fill).toBeNull();
    expect(bad({ ...base, items: [{ k: 'point', x: 0, y: 0, style: { fill: { type: 'linear', x0: 0, y0: 0, x1: 1, y1: 0, stops: [{ color: 'url(x)' }] } } }] })).toMatch(/gradient colour/);
  });
  it('background, loop and animated', () => {
    expect(ok({ ...base, background: '#111', loop: 4, animated: true })).toMatchObject({ background: '#111', loop: 4, animated: true });
    expect(ok({ ...base, background: 'expression(alert(1))', loop: -3, animated: 'yes' })).toMatchObject({ background: null, loop: null, animated: false });
  });
});

describe('safeColor', () => {
  it('allows plain CSS colours only', () => {
    for (const c of ['#fff', '#c74440', '#c7444080', 'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)', 'hsl(120 50% 50%)', 'hsla(1, 2%, 3%, 0.4)', 'tomato', 'transparent']) {
      expect(safeColor(c), c).toBe(c);
    }
    for (const c of ['url(x)', 'red; background: x', 'rgb(1,2)', 'x'.repeat(100), '', 3, null, 'var(--x)', 'expression(1)']) {
      expect(safeColor(c), String(c)).toBeNull();
    }
  });
});

describe('runtime messages', () => {
  it('parses ready / frame / error and rejects anything else', () => {
    expect(parseRuntimeMessage({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(parseRuntimeMessage({ type: 'frame', id: 3, frame: base })).toMatchObject({ type: 'frame', id: 3 });
    expect(parseRuntimeMessage({ type: 'frame', id: 3, frame: { items: [{ k: 'x' }] } })).toMatchObject({ type: 'invalid', id: 3 });
    expect(parseRuntimeMessage({ type: 'error', id: 1, error: { message: 'boom', line: 4, column: 2 } })).toEqual({
      type: 'error',
      id: 1,
      error: { message: 'boom', line: 4, column: 2 },
    });
    expect(parseRuntimeMessage({ type: 'frame', frame: base })).toBeNull();
    expect(parseRuntimeMessage({ type: 'eval', code: 'x' })).toBeNull();
    expect(parseRuntimeMessage('ready')).toBeNull();
    expect(parseRuntimeMessage(null)).toBeNull();
  });
  it('sanitizeError caps and type-checks', () => {
    expect(sanitizeError({ message: 'x'.repeat(5000), line: -1, column: 1.5 })).toEqual({ message: 'x'.repeat(SCRIPT_LIMITS.maxLogLine) });
    expect(sanitizeError(null)).toEqual({ message: 'Script error' });
  });
});
