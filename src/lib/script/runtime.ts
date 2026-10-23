/**
 * The Fluxion drawing API and script executor.
 *
 * A script is the body of one function, re-run for every frame. Its free names
 * (circle, time, slider, …) are the API, passed in as parameters, so a script
 * is plain JavaScript with no imports. Shapes are collected into a display list
 * in data coordinates (protocol.ts), which the app validates and draws.
 *
 * This module is pure: it runs unchanged inside the sandbox worker
 * (sandbox/worker.ts) and in Node (tests, the CLI checker). It is NOT a
 * security boundary by itself — isolation comes from where it runs.
 */
import {
  IDENTITY,
  OP,
  SCRIPT_LIMITS,
  usesClock,
  type ClipMeta,
  type DisplayItem,
  type GradientStop,
  type ItemStyle,
  type Mat,
  type Paint,
  type ScriptError,
  type ScriptFrame,
  type ScriptInputs,
  type SliderDecl,
} from './protocol';
import { hslToRgb, hsvToRgb, parseColorLiteral, toCss, type RGBA } from '../color';
import { project3 } from '../math/helpers';
import { API_NAMES } from './api';

/** Bridge to the Graph-mode expressions (graphBridge.ts), if any. */
export interface GraphBridge {
  value(name: string): number | undefined;
  fn(name: string): ((...args: number[]) => number) | undefined;
  ode(name: string, order: number): ((t: number) => number) | undefined;
  names(): string[];
}

export interface RunEnv {
  inputs: ScriptInputs;
  graph?: GraphBridge | null;
  clips?: ClipMeta[];
}

export { API_NAMES, API_SIGNATURES } from './api';

export interface CompiledScript {
  code: string;
  fn: (...args: unknown[]) => unknown;
  animated: boolean;
}

export interface RunResult {
  frame: ScriptFrame;
  error?: ScriptError;
}

const L = SCRIPT_LIMITS;

// ── compile ───────────────────────────────────────────────────────────────────

// The body sits in its own block so a script may declare names that shadow the
// API (`const scale = 2`, `const E = …`) instead of hitting "already declared".
const PRELUDE = '"use strict"; {\n';
const EPILOGUE = '\n}';

// How many lines the Function constructor puts before the body (engine
// dependent), measured once with a probe that throws on body line 1.
let lineOffset: number | null = null;
function measureOffset(): number {
  if (lineOffset !== null) return lineOffset;
  try {
    new Function('throw new Error("probe")')();
  } catch (err) {
    const loc = stackLocation(err);
    lineOffset = loc ? loc.line - 1 : 2;
  }
  return lineOffset ?? 2;
}

function stackLocation(err: unknown): { line: number; column: number } | null {
  const stack = err instanceof Error ? String(err.stack ?? '') : '';
  // V8 / Node: "(eval at …, <anonymous>:LINE:COL)"; Firefox: "> Function:LINE:COL";
  // Safari: none. (Not "evalmachine.<anonymous>", the host script under node:vm.)
  const m = stack.match(/(?:, <anonymous>|> Function):(\d+):(\d+)/);
  return m ? { line: Number(m[1]), column: Number(m[2]) } : null;
}

/** 1-based line in the user's code where `err` was thrown, if the stack says. */
export function errorLocation(err: unknown): { line: number; column: number } | null {
  const loc = stackLocation(err);
  if (!loc) return null;
  const line = loc.line - measureOffset() - 1; // − the "use strict" prelude line
  return line >= 1 ? { line, column: loc.column } : null;
}

export function toScriptError(err: unknown): ScriptError {
  const name = err instanceof Error ? err.name : '';
  let message = err instanceof Error ? err.message : String(err);
  if (name && name !== 'Error') message = `${name}: ${message}`;
  const out: ScriptError = { message: message.slice(0, L.maxLogLine) };
  const loc = errorLocation(err);
  if (loc) {
    out.line = loc.line;
    out.column = loc.column;
  }
  return out;
}

export function compileScript(code: string): { ok: true; script: CompiledScript } | { ok: false; error: ScriptError } {
  if (code.length > L.maxCodeChars) {
    return { ok: false, error: { message: `The script is too long (${code.length} characters; max ${L.maxCodeChars}).` } };
  }
  try {
    const fn = new Function(...API_NAMES, PRELUDE + code + EPILOGUE) as CompiledScript['fn'];
    return { ok: true, script: { code, fn, animated: usesClock(code) } };
  } catch (err) {
    // Engines don't report where a Function-constructor SyntaxError is; the
    // editor's own parser marks the line.
    return { ok: false, error: toScriptError(err) };
  }
}

// ── helpers (pure) ────────────────────────────────────────────────────────────

export class ScriptUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Error';
  }
}

function fail(msg: string): never {
  throw new ScriptUsageError(msg);
}

function describe(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return `"${v.slice(0, 20)}"`;
  if (Array.isArray(v)) return 'an array';
  return typeof v === 'object' ? 'an object' : String(v);
}

function num(v: unknown, fn: string, what: string): number {
  if (typeof v !== 'number') fail(`${fn}: ${what} must be a number (got ${describe(v)})`);
  return v;
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (x: number, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
export function smoothstep(e0: number, e1: number, x: number): number {
  if (e0 === e1) return x < e0 ? 0 : 1;
  const u = clamp((x - e0) / (e1 - e0));
  return u * u * (3 - 2 * u);
}
export function ease(t: number, kind: 'inOut' | 'in' | 'out' | 'linear' = 'inOut'): number {
  const x = clamp(t);
  if (kind === 'linear') return x;
  if (kind === 'in') return x * x * x;
  if (kind === 'out') return 1 - (1 - x) ** 3;
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}
export const map = (x: number, a: number, b: number, c: number, d: number) => (b === a ? c : c + ((x - a) * (d - c)) / (b - a));
export const mod = (x: number, m: number) => ((x % m) + m) % m;
export function range(a: number, b?: number, step = 1): number[] {
  const [from, to] = b === undefined ? [0, a] : [a, b];
  if (!(step !== 0) || !Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(step)) return [];
  const n = Math.max(0, Math.ceil((to - from) / step));
  if (n > 1e6) fail(`range: too many values (${n})`);
  return Array.from({ length: n }, (_, i) => from + i * step);
}
/** Deterministic pseudo-random 0…1 from a seed (stable across frames). */
export function rand(seed: number): number {
  let h = Math.imul((seed * 1e4) | 0 ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Colour: anything CSS-ish in, an rgba() string out.
function toRGBA(c: unknown, fn: string): RGBA {
  if (typeof c !== 'string') fail(`${fn}: expected a colour string like "#c74440" or rgb(…) (got ${describe(c)})`);
  const lit = parseColorLiteral(c);
  if (lit) return lit;
  const m = c.trim().match(/^(rgba?|hsla?|hsv)\(([^)]*)\)$/i);
  if (m) {
    const p = m[2].split(/[\s,/]+/).filter(Boolean).map((s) => parseFloat(s) * (s.endsWith('%') ? 0.01 : 1));
    const k = m[1].toLowerCase();
    const a = p[3] ?? 1;
    if (k.startsWith('rgb')) return { r: p[0], g: p[1], b: p[2], a };
    const [r, g, b] = k === 'hsv' ? hsvToRgb(p[0], p[1], p[2]) : hslToRgb(p[0], p[1], p[2]);
    return { r, g, b, a };
  }
  fail(`${fn}: can't read colour ${describe(c)} — use "#rrggbb", rgb(), hsv() or hsl()`);
}
export const rgb = (r: number, g: number, b: number, a = 1) =>
  toCss({ r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: clamp(a) });
export const hsv = (h: number, s: number, v: number, a = 1) => {
  const [r, g, b] = hsvToRgb(h, s, v);
  return toCss({ r, g, b, a: clamp(a) });
};
export const hsl = (h: number, s: number, l: number, a = 1) => {
  const [r, g, b] = hslToRgb(h, s, l);
  return toCss({ r, g, b, a: clamp(a) });
};
export function mix(c1: string, c2: string, t: number): string {
  const a = toRGBA(c1, 'mix');
  const b = toRGBA(c2, 'mix');
  const u = clamp(t);
  return toCss({ r: lerp(a.r, b.r, u), g: lerp(a.g, b.g, u), b: lerp(a.b, b.b, u), a: lerp(a.a, b.a, u) });
}
export function alpha(c: string, a: number): string {
  const x = toRGBA(c, 'alpha');
  return toCss({ ...x, a: clamp(a) });
}

function gradientStops(colors: unknown, fn: string): GradientStop[] {
  if (!Array.isArray(colors) || colors.length === 0) fail(`${fn}: give a list of colours, e.g. ["red", "blue"]`);
  return colors.slice(0, L.maxStops).map((c, i) => {
    if (Array.isArray(c)) return { offset: clamp(Number(c[0])), color: String(c[1]) };
    return { offset: colors.length === 1 ? 0 : i / (colors.length - 1), color: String(c) };
  });
}

/**
 * Keyframe track: `keys` is [[t0, v0], [t1, v1], …] in increasing time; values
 * may be numbers, arrays of numbers or colours. Held flat outside the keys.
 */
export function keyframes(t: number, keys: unknown, opts: { ease?: boolean | 'linear' | 'smooth' } = {}): unknown {
  if (!Array.isArray(keys) || keys.length === 0 || !keys.every((k) => Array.isArray(k) && k.length >= 2)) {
    fail('keyframes: keys must be a list like [[0, 1], [2, 5]] (time, value)');
  }
  const smooth = opts.ease === undefined || opts.ease === true || opts.ease === 'smooth';
  const blend = (a: unknown, b: unknown, u: number): unknown => {
    if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, u);
    if (typeof a === 'string' && typeof b === 'string') return mix(a, b, u);
    if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => blend(x, b[i], u));
    return u < 0.5 ? a : b;
  };
  const ks = keys as [number, unknown][];
  if (!(t > ks[0][0])) return ks[0][1];
  for (let i = 0; i < ks.length - 1; i++) {
    const [t0, v0] = ks[i];
    const [t1, v1] = ks[i + 1];
    if (t <= t1) {
      if (t1 <= t0) return v1;
      let u = (t - t0) / (t1 - t0);
      if (smooth) u = u * u * (3 - 2 * u);
      return blend(v0, v1, u);
    }
  }
  return ks[ks.length - 1][1];
}

// Matrices: [a, b, c, d, e, f] like canvas: x' = a x + c y + e, y' = b x + d y + f.
export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
export const apply = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function toPoints(v: unknown, fn: string): [number, number][] {
  if (!Array.isArray(v)) fail(`${fn}: points must be a list like [[0, 0], [1, 2], [2, 0]]`);
  if (v.length && typeof v[0] === 'number') {
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < v.length; i += 2) out.push([v[i] as number, v[i + 1] as number]);
    return out;
  }
  return v.map((p, i) => {
    if (Array.isArray(p)) return [Number(p[0]), Number(p[1])] as [number, number];
    if (p && typeof p === 'object' && 'x' in p) return [Number((p as { x: unknown }).x), Number((p as { y: unknown }).y)] as [number, number];
    fail(`${fn}: point ${i} should be [x, y] (got ${describe(p)})`);
  });
}

const fin = Number.isFinite;

// ── run ───────────────────────────────────────────────────────────────────────

export interface StyleOpts {
  color?: string | null | false;
  stroke?: string | null | false;
  fill?: string | boolean | Paint | null;
  width?: number;
  dash?: 'solid' | 'dashed' | 'dotted' | number[];
  opacity?: number;
  cap?: ItemStyle['cap'];
  join?: ItemStyle['join'];
  [k: string]: unknown;
}

/**
 * Run a compiled script for one frame. Never throws: an error comes back with
 * whatever was drawn before it.
 */
export function runScript(script: CompiledScript, env: RunEnv): RunResult {
  const { inputs } = env;
  const started = now();
  const items: DisplayItem[] = [];
  const sliders: SliderDecl[] = [];
  const logs: string[] = [];
  let loopLen: number | null = null;
  let animated = script.animated;
  let numbers = 0;
  let M: Mat = IDENTITY;
  const stack: Mat[] = [];
  const ink = inputs.theme === 'dark' ? '#e8eaed' : '#1f2328';

  const spend = (n: number) => {
    numbers += n;
    if (items.length > L.maxItems) fail(`Too many shapes (over ${L.maxItems.toLocaleString('en')}). Draw fewer, or join them into one path().`);
    if (numbers > L.maxNumbers) fail(`Too many points (over ${(L.maxNumbers / 2).toLocaleString('en')}). Lower the sample counts.`);
  };

  function styleOf(o: unknown, fn: string, kind: 'shape' | 'open' | 'point' | 'text' = 'shape'): ItemStyle {
    if (o !== undefined && (o === null || typeof o !== 'object' || Array.isArray(o))) {
      fail(`${fn}: the last argument should be a style like { color: "red", fill: "pink", width: 3 }`);
    }
    const s = (o ?? {}) as StyleOpts;
    const colorOpt = s.color !== undefined ? s.color : s.stroke;
    const hasFill = s.fill !== undefined && s.fill !== null && s.fill !== false;
    let stroke: string | null;
    if (colorOpt === null || colorOpt === false || colorOpt === 'none') stroke = null;
    else if (typeof colorOpt === 'string') stroke = colorOpt;
    else stroke = hasFill && kind === 'shape' ? null : ink;
    let fill: Paint | null = null;
    if (s.fill === true) fill = stroke ?? ink;
    else if (typeof s.fill === 'string') fill = s.fill === 'none' ? null : s.fill;
    else if (s.fill && typeof s.fill === 'object') fill = s.fill as Paint;
    if (kind === 'point' || kind === 'text') {
      // Points and text are filled with their colour.
      fill = fill ?? stroke ?? ink;
      stroke = kind === 'point' && typeof s.stroke === 'string' ? s.stroke : null;
    }
    let dash: number[] = [];
    if (s.dash === 'dashed') dash = [8, 6];
    else if (s.dash === 'dotted') dash = [2, 5];
    else if (Array.isArray(s.dash)) dash = s.dash.map(Number).filter(fin);
    return {
      stroke,
      fill,
      width: typeof s.width === 'number' && fin(s.width) ? Math.max(0, s.width) : 2,
      dash,
      opacity: typeof s.opacity === 'number' && fin(s.opacity) ? clamp(s.opacity) : 1,
      cap: s.cap ?? 'round',
      join: s.join ?? 'round',
    };
  }

  // A path item in local coordinates (current matrix attached).
  function addPath(ops: number[], st: ItemStyle): void {
    if (ops.length === 0) return;
    items.push({ k: 'path', ops, m: M, style: st });
    spend(ops.length + 6);
  }

  function polyOps(pts: [number, number][], closed: boolean): number[] {
    // NaN / Infinity points break the line (a gap) instead of failing.
    const ops: number[] = [];
    let pen = false;
    for (const [x, y] of pts) {
      if (!fin(x) || !fin(y) || Math.abs(x) > L.maxAbs || Math.abs(y) > L.maxAbs) {
        pen = false;
        continue;
      }
      ops.push(pen ? OP.line : OP.move, x, y);
      pen = true;
    }
    if (closed && ops.length) ops.push(OP.close);
    return ops;
  }

  const okNums = (...v: number[]) => v.every((x) => fin(x) && Math.abs(x) <= L.maxAbs);

  function ellipseOps(x: number, y: number, rx: number, ry: number, a0 = 0, a1 = Math.PI * 2, ccw = false): number[] {
    return [OP.ellipse, x, y, Math.abs(rx), Math.abs(ry), 0, a0, a1, ccw ? 1 : 0];
  }

  // Shapes ---------------------------------------------------------------------
  const circle = (x: number, y: number, r: number, style?: StyleOpts) => {
    num(x, 'circle', 'x'), num(y, 'circle', 'y'), num(r, 'circle', 'r');
    const st = styleOf(style, 'circle');
    if (okNums(x, y, r)) addPath([...ellipseOps(x, y, r, r), OP.close], st);
  };
  const ellipse = (x: number, y: number, rx: number, ry: number, style?: StyleOpts) => {
    num(x, 'ellipse', 'x'), num(y, 'ellipse', 'y'), num(rx, 'ellipse', 'rx'), num(ry, 'ellipse', 'ry');
    const st = styleOf(style, 'ellipse');
    if (okNums(x, y, rx, ry)) addPath([...ellipseOps(x, y, rx, ry), OP.close], st);
  };
  const arc = (x: number, y: number, r: number, a0: number, a1: number, style?: StyleOpts) => {
    for (const [v, n] of [[x, 'x'], [y, 'y'], [r, 'r'], [a0, 'startAngle'], [a1, 'endAngle']] as const) num(v, 'arc', n);
    const st = styleOf(style, 'arc', 'open');
    if (okNums(x, y, r, a0, a1)) addPath(ellipseOps(x, y, r, r, a0, a1, a1 < a0), st);
  };
  const rect = (x: number, y: number, w: number, h: number, style?: StyleOpts) => {
    num(x, 'rect', 'x'), num(y, 'rect', 'y'), num(w, 'rect', 'width'), num(h, 'rect', 'height');
    const st = styleOf(style, 'rect');
    if (!okNums(x, y, w, h)) return;
    const r0 = typeof style?.radius === 'number' ? Math.max(0, Math.min(style.radius as number, Math.abs(w) / 2, Math.abs(h) / 2)) : 0;
    const [x0, x1] = w < 0 ? [x + w, x] : [x, x + w];
    const [y0, y1] = h < 0 ? [y + h, y] : [y, y + h];
    if (!r0) {
      addPath([OP.move, x0, y0, OP.line, x1, y0, OP.line, x1, y1, OP.line, x0, y1, OP.close], st);
      return;
    }
    const q = Math.PI / 2;
    addPath(
      [
        OP.move, x0 + r0, y0,
        OP.line, x1 - r0, y0,
        OP.ellipse, x1 - r0, y0 + r0, r0, r0, 0, -q, 0, 0,
        OP.line, x1, y1 - r0,
        OP.ellipse, x1 - r0, y1 - r0, r0, r0, 0, 0, q, 0,
        OP.line, x0 + r0, y1,
        OP.ellipse, x0 + r0, y1 - r0, r0, r0, 0, q, 2 * q, 0,
        OP.line, x0, y0 + r0,
        OP.ellipse, x0 + r0, y0 + r0, r0, r0, 0, 2 * q, 3 * q, 0,
        OP.close,
      ],
      st,
    );
  };
  const polygon = (pts: unknown, style?: StyleOpts) => addPath(polyOps(toPoints(pts, 'polygon'), true), styleOf(style, 'polygon'));
  const polyline = (pts: unknown, style?: StyleOpts) =>
    addPath(polyOps(toPoints(pts, 'polyline'), false), styleOf(style, 'polyline', 'open'));
  const line = (x1: number, y1: number, x2: number, y2: number, style?: StyleOpts) => {
    for (const [v, n] of [[x1, 'x1'], [y1, 'y1'], [x2, 'x2'], [y2, 'y2']] as const) num(v, 'line', n);
    const st = styleOf(style, 'line', 'open');
    if (okNums(x1, y1, x2, y2)) addPath([OP.move, x1, y1, OP.line, x2, y2], st);
  };
  const arrow = (x1: number, y1: number, x2: number, y2: number, style?: StyleOpts) => {
    for (const [v, n] of [[x1, 'x1'], [y1, 'y1'], [x2, 'x2'], [y2, 'y2']] as const) num(v, 'arrow', n);
    const st = styleOf(style, 'arrow', 'open');
    if (!okNums(x1, y1, x2, y2)) return;
    const [ax, ay] = apply(M, x1, y1);
    const [bx, by] = apply(M, x2, y2);
    const head = typeof style?.head === 'number' && fin(style.head) ? (style.head as number) : 10 + st.width * 1.5;
    items.push({ k: 'arrow', x1: ax, y1: ay, x2: bx, y2: by, head, style: st });
    spend(4);
  };
  const point = (x: number, y: number, style?: StyleOpts) => {
    num(x, 'point', 'x'), num(y, 'point', 'y');
    const st = styleOf(style, 'point', 'point');
    if (!okNums(x, y)) return;
    const [px, py] = apply(M, x, y);
    const r = typeof style?.size === 'number' && fin(style.size) ? (style.size as number) : 4;
    items.push({ k: 'point', x: px, y: py, r, style: st });
    spend(2);
  };
  const drawText = (s: unknown, x: number, y: number, style: StyleOpts | undefined, isLabel: boolean) => {
    const fn = isLabel ? 'label' : 'text';
    num(x, fn, 'x'), num(y, fn, 'y');
    const st = styleOf(style, fn, 'text');
    if (!okNums(x, y)) return;
    const [px, py] = apply(M, x, y);
    const o = (style ?? {}) as Record<string, unknown>;
    const str = typeof s === 'number' ? String(+s.toPrecision(6)) : String(s);
    items.push({
      k: 'text',
      x: px,
      y: py,
      text: str.slice(0, L.maxText),
      size: typeof o.size === 'number' ? o.size : isLabel ? 13 : 16,
      align: (o.align as 'left') ?? (isLabel ? 'left' : 'center'),
      baseline: (o.baseline as 'middle') ?? (isLabel ? 'bottom' : 'middle'),
      font: (o.font as 'sans') ?? 'sans',
      bold: o.bold === true,
      angle: Math.atan2(M[1], M[0]),
      halo: isLabel || o.halo === true,
      style: st,
    });
    spend(2 + str.length / 8);
  };
  const text = (s: unknown, x: number, y: number, style?: StyleOpts) => drawText(s, x, y, style, false);
  const label = (s: unknown, x: number, y: number, style?: StyleOpts) => drawText(s, x, y, style, true);

  const path = (style?: StyleOpts) => {
    const ops: number[] = [];
    const st = styleOf(style, 'path', 'open');
    // Registered now (keeps draw order), filled in by the builder calls.
    const item: DisplayItem = { k: 'path', ops, m: M, style: st };
    items.push(item);
    spend(6);
    const push = (...v: number[]) => {
      if (!v.slice(1).every((x) => fin(x) && Math.abs(x) <= L.maxAbs)) return b;
      ops.push(...v);
      spend(v.length);
      return b;
    };
    const b = {
      moveTo: (x: number, y: number) => push(OP.move, num(x, 'moveTo', 'x'), num(y, 'moveTo', 'y')),
      lineTo: (x: number, y: number) => push(ops.length ? OP.line : OP.move, num(x, 'lineTo', 'x'), num(y, 'lineTo', 'y')),
      quadTo: (cx: number, cy: number, x: number, y: number) => push(OP.quad, cx, cy, x, y),
      bezierTo: (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) =>
        push(OP.cubic, c1x, c1y, c2x, c2y, x, y),
      arc: (cx: number, cy: number, r: number, a0: number, a1: number, ccw = a1 < a0) =>
        push(OP.ellipse, cx, cy, Math.abs(r), Math.abs(r), 0, a0, a1, ccw ? 1 : 0),
      close: () => {
        if (ops.length) ops.push(OP.close);
        return b;
      },
    };
    return b;
  };

  const sampleCurve = (f: unknown, t0: number, t1: number, n: number, fn: string): [number, number][] => {
    if (typeof f !== 'function') fail(`${fn}: the first argument must be a function, like t => [cos(t), sin(t)]`);
    const count = Math.max(2, Math.min(5000, Math.round(n)));
    const pts: [number, number][] = [];
    for (let i = 0; i <= count; i++) {
      const t = t0 + ((t1 - t0) * i) / count;
      const p = (f as (t: number) => unknown)(t);
      if (Array.isArray(p)) pts.push([Number(p[0]), Number(p[1])]);
      else if (p && typeof p === 'object') pts.push([Number((p as { x: unknown }).x), Number((p as { y: unknown }).y)]);
      else pts.push([NaN, NaN]);
    }
    return pts;
  };
  const curve = (f: unknown, t0 = 0, t1 = Math.PI * 2, style?: StyleOpts) => {
    num(t0, 'curve', 'tFrom'), num(t1, 'curve', 'tTo');
    const st = styleOf(style, 'curve', 'shape');
    const samples = typeof style?.samples === 'number' ? (style.samples as number) : 240;
    const closed = st.fill !== null || style?.closed === true;
    addPath(polyOps(sampleCurve(f, t0, t1, samples, 'curve'), closed), st);
  };
  const plot = (f: unknown, style?: StyleOpts) => {
    if (typeof f !== 'function') fail('plot: give a function, like x => sin(x)');
    const st = styleOf(style, 'plot', 'open');
    const { xmin, xmax, ymin, ymax } = inputs.view;
    const n = typeof style?.samples === 'number' ? (style.samples as number) : 600;
    const span = ymax - ymin;
    const raw = sampleCurve((x: number) => [x, (f as (x: number) => number)(x)], xmin, xmax, n, 'plot');
    // Break the line at jumps far outside the view (asymptotes).
    const pts = raw.map(([x, y]) => [x, Math.abs(y - (ymin + ymax) / 2) > span * 50 ? NaN : y] as [number, number]);
    addPath(polyOps(pts, false), st);
  };
  const background = (c: unknown) => {
    if (typeof c !== 'string') fail('background: give a colour, like background("#101418")');
    background_ = c;
  };
  let background_: string | null = null;

  // Transforms -----------------------------------------------------------------
  const pushT = () => {
    if (stack.length > 256) fail('push: too many nested push() calls (did you forget pop()?)');
    stack.push(M);
  };
  const popT = () => {
    M = stack.pop() ?? IDENTITY;
  };
  const translate = (x: number, y: number) => {
    M = mul(M, [1, 0, 0, 1, num(x, 'translate', 'x'), num(y, 'translate', 'y')]);
  };
  const rotate = (a: number, cx = 0, cy = 0) => {
    num(a, 'rotate', 'angle');
    const c = Math.cos(a);
    const s = Math.sin(a);
    M = mul(M, [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]);
  };
  const scaleT = (sx: number, sy?: number) => {
    num(sx, 'scale', 'sx');
    M = mul(M, [sx, 0, 0, sy ?? sx, 0, 0]);
  };
  const group = (opts: unknown, fn?: unknown) => {
    const body = typeof opts === 'function' ? opts : fn;
    const o = (typeof opts === 'object' && opts ? opts : {}) as Record<string, unknown>;
    if (typeof body !== 'function') fail('group: give a function to draw, like group({ rotate: 1 }, () => { … })');
    pushT();
    try {
      if (Array.isArray(o.translate)) translate(Number(o.translate[0]), Number(o.translate[1]));
      const origin = Array.isArray(o.origin) ? [Number(o.origin[0]), Number(o.origin[1])] : [0, 0];
      if (typeof o.rotate === 'number') rotate(o.rotate, origin[0], origin[1]);
      if (o.scale !== undefined) {
        const [sx, sy] = Array.isArray(o.scale) ? [Number(o.scale[0]), Number(o.scale[1])] : [Number(o.scale), Number(o.scale)];
        translate(origin[0], origin[1]);
        scaleT(sx, sy);
        translate(-origin[0], -origin[1]);
      }
      (body as () => void)();
    } finally {
      popT();
    }
  };

  // 3D ---------------------------------------------------------------------------
  type Cam = { yaw?: number; pitch?: number; dist?: number; scale?: number };
  const project3d = (p: unknown, cam: Cam = {}): [number, number] => {
    if (!Array.isArray(p) || p.length < 3) fail('project3d: give a 3D point like [x, y, z]');
    const [x, y] = project3(Number(p[0]), Number(p[1]), Number(p[2]), cam.yaw ?? 0, cam.pitch ?? 0, cam.dist ?? 0);
    const s = cam.scale ?? 1;
    return [x * s, y * s];
  };
  const camera = (cam: Cam = {}) => {
    const pr = (p: unknown) => project3d(p, cam);
    return {
      project: pr,
      point: (p: unknown, style?: StyleOpts) => {
        const [x, y] = pr(p);
        point(x, y, style);
      },
      line: (a: unknown, b: unknown, style?: StyleOpts) => {
        const [x1, y1] = pr(a);
        const [x2, y2] = pr(b);
        if (okNums(x1, y1, x2, y2)) line(x1, y1, x2, y2, style);
      },
      polyline: (pts: unknown[], style?: StyleOpts) => polyline(pts.map(pr), style),
      polygon: (pts: unknown[], style?: StyleOpts) => polygon(pts.map(pr), style),
      /** Depth of a 3D point towards the viewer (bigger = nearer) — for sorting faces. */
      depth: (p: unknown) => {
        if (!Array.isArray(p)) return 0;
        const cy = Math.cos(cam.yaw ?? 0);
        const sy = Math.sin(cam.yaw ?? 0);
        const z1 = -Number(p[0]) * sy + Number(p[2]) * cy;
        return Number(p[1]) * Math.sin(cam.pitch ?? 0) + z1 * Math.cos(cam.pitch ?? 0);
      },
    };
  };

  // Clock & inputs ---------------------------------------------------------------
  // `time` is a parameter, so loop() can't rebind it mid-run: the host wraps
  // its clock by the frame's `loop` value (the first frame starts at 0 anyway).
  const loop = (seconds: number) => {
    num(seconds, 'loop', 'seconds');
    if (!(seconds > 0)) fail('loop: seconds must be positive');
    loopLen = seconds;
    animated = true;
  };
  const slider = (name: unknown, min = 0, max = 1, value?: number, step = 0): number => {
    if (typeof name !== 'string' || !/^[A-Za-z_$][\w$ ]*$/.test(name) || name.length > L.maxName) {
      fail('slider: the name must be a short word, like slider("speed", 0, 5, 1)');
    }
    num(min, 'slider', 'min'), num(max, 'slider', 'max');
    if (!(max > min)) fail(`slider "${name}": max must be bigger than min`);
    const dflt = typeof value === 'number' && fin(value) ? clamp(value, min, max) : min;
    let decl = sliders.find((s) => s.name === name);
    if (!decl) {
      if (sliders.length >= L.maxSliders) fail(`Too many sliders (max ${L.maxSliders})`);
      decl = { name, min, max, value: dflt, step: typeof step === 'number' && step > 0 ? step : 0 };
      sliders.push(decl);
    }
    const v = inputs.sliders[name];
    return typeof v === 'number' && fin(v) ? clamp(v, min, max) : dflt;
  };

  // Grapher interop ----------------------------------------------------------------
  const bridge = env.graph ?? null;
  const need = (name: unknown, fn: string): string => {
    if (typeof name !== 'string') fail(`graph.${fn}: give the name of a Graph-mode expression, like graph.${fn}("k")`);
    return name;
  };
  const graph = Object.freeze({
    value(name: string): number {
      const n = need(name, 'value');
      const v = bridge?.value(n);
      if (v === undefined) fail(`graph.value("${n}"): no slider or value called ${n} in Graph mode`);
      return v;
    },
    fn(name: string): (...args: number[]) => number {
      const n = need(name, 'fn');
      const f = bridge?.fn(n);
      if (!f) fail(`graph.fn("${n}"): no function called ${n} in Graph mode (define one like ${n}(x) = x^2)`);
      return f;
    },
    ode(name: string, derivative = 0): (t: number) => number {
      const n = need(name, 'ode');
      const f = bridge?.ode(n, derivative);
      if (!f) fail(`graph.ode("${n}"): no differential equation for ${n} in Graph mode (add one like ${n}'' = -sin(${n}))`);
      return f;
    },
    has(name: string): boolean {
      return typeof name === 'string' && !!bridge && bridge.names().includes(name);
    },
    names(): string[] {
      return bridge ? bridge.names() : [];
    },
  });

  // Clips ------------------------------------------------------------------------
  const clips = env.clips ?? [];
  const clip = (name: unknown) => {
    if (typeof name !== 'string') fail('clip: give the name of an imported clip, like clip("apple")');
    const meta = clips.find((c) => c.name === name);
    if (!meta) {
      const have = clips.map((c) => `"${c.name}"`).join(', ');
      fail(`clip("${name}"): no imported clip with that name${have ? ` (you have ${have})` : ' — import one with the film button'}`);
    }
    const [bx0, by0, bx1, by1] = meta.box;
    const bw = bx1 - bx0;
    const bh = by1 - by0;
    const frameAt = (t: number) => (meta.frames ? mod(Math.floor(t * meta.fps), meta.frames) : 0);
    const draw = (f: number, opts?: StyleOpts & { x?: number; y?: number; width?: number; height?: number }) => {
      num(f, 'clip.draw', 'frame');
      const o = (opts ?? {}) as Record<string, unknown>;
      const cx = typeof o.x === 'number' ? o.x : (bx0 + bx1) / 2;
      const cy = typeof o.y === 'number' ? o.y : (by0 + by1) / 2;
      let w = typeof o.width === 'number' ? o.width : undefined;
      let h = typeof o.height === 'number' ? o.height : undefined;
      if (w === undefined && h === undefined) [w, h] = [bw, bh];
      else if (w === undefined) w = (h! * bw) / bh;
      else if (h === undefined) h = (w * bh) / bw;
      const sx = w / bw;
      const sy = h! / bh;
      // Map the clip's own box onto the target rectangle, then the current transform.
      const local: Mat = [sx, 0, 0, sy, cx - sx * (bx0 + bx1) / 2, cy - sy * (by0 + by1) / 2];
      const st = styleOf(opts, 'clip.draw');
      if (st.fill === null && st.stroke === null) st.fill = ink;
      if (o.fill === undefined && o.color === undefined && o.stroke === undefined) {
        st.fill = ink;
        st.stroke = null;
      }
      if (!fin(f)) return;
      items.push({ k: 'clip', id: meta.id, frame: mod(Math.floor(f), Math.max(1, meta.frames)), m: mul(M, local), style: st });
      spend(16);
    };
    return Object.freeze({
      name: meta.name,
      frames: meta.frames,
      fps: meta.fps,
      duration: meta.frames / meta.fps,
      box: [...meta.box],
      frameAt,
      draw,
      play: (opts?: StyleOpts & { x?: number; y?: number; width?: number; height?: number }) => {
        animated = true;
        draw(frameAt(inputs.time), opts);
      },
    });
  };

  // Console --------------------------------------------------------------------------
  const fmt = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(+v.toPrecision(8));
    try {
      return JSON.stringify(v, (_k, x) => (typeof x === 'number' ? +x.toPrecision(8) : x)) ?? String(v);
    } catch {
      return String(v);
    }
  };
  const print = (...args: unknown[]) => {
    if (logs.length < L.maxLogs) logs.push(args.map(fmt).join(' ').slice(0, L.maxLogLine));
  };
  const consoleObj = Object.freeze({ log: print, info: print, warn: print, error: print, debug: print });

  const values: Record<(typeof API_NAMES)[number], unknown> = {
    circle, ellipse, rect, polygon, polyline, line, arrow, point, arc, text, label, path, curve, plot, background,
    push: pushT, pop: popT, translate, rotate, scale: scaleT, group,
    rgb, hsv, hsl, mix, alpha,
    linearGradient: (x0: number, y0: number, x1: number, y1: number, colors: unknown): Paint => {
      const [ax, ay] = apply(M, x0, y0);
      const [bx, by] = apply(M, x1, y1);
      return { type: 'linear', x0: ax, y0: ay, x1: bx, y1: by, stops: gradientStops(colors, 'linearGradient') };
    },
    radialGradient: (x: number, y: number, r: number, colors: unknown): Paint => {
      const [cx, cy] = apply(M, x, y);
      const k = Math.hypot(M[0], M[1]);
      return { type: 'radial', x0: cx, y0: cy, r0: 0, x1: cx, y1: cy, r1: Math.abs(r * k), stops: gradientStops(colors, 'radialGradient') };
    },
    lerp, clamp, smoothstep, ease, keyframes, map, range, rand,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, sign: Math.sign,
    floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc, min: Math.min, max: Math.max,
    pow: Math.pow, exp: Math.exp, log: Math.log, log2: Math.log2, log10: Math.log10, hypot: Math.hypot,
    random: Math.random, mod,
    PI: Math.PI, TAU: Math.PI * 2, E: Math.E,
    project3d, camera,
    time: inputs.time, frame: Math.floor(inputs.time * 60), loop, slider,
    graph, clip, view: Object.freeze({ ...inputs.view }), theme: inputs.theme, ink, print, console: consoleObj,
  };

  let error: ScriptError | undefined;
  try {
    script.fn(...API_NAMES.map((n) => values[n]));
  } catch (err) {
    error = toScriptError(err);
  }
  // Drop empty paths (a path() that was never given points).
  const kept = items.filter((it) => it.k !== 'path' || it.ops.length > 0);
  // Gradients and colours are validated by the app; strip anything non-plain here
  // so a frame always survives structured cloning.
  const frame: ScriptFrame = {
    items: kept,
    background: background_,
    sliders,
    logs,
    loop: loopLen,
    ms: now() - started,
    animated,
  };
  return error ? { frame, error } : { frame };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
