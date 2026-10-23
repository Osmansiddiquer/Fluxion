import { parse as mjParse, type EvalFunction } from 'mathjs';
import { normalizeInput } from './math/normalize';
import { calledFunctions } from './math/parse';
import { KNOWN_FUNCTIONS } from './math/builtins';

/**
 * Colour values and colour *expressions*. An entry's colour can be a literal
 * (`#c74440`, `#fff`, `#00000080`, a few CSS names) or an expression evaluated
 * against the live variable scope — `rgb(255*a, 40, 40)`, `hsv(360*T, 0.8, 1)`,
 * `rgba(0, 0, 0, keys(T, 0, 0, 1, 1))` — so colour and opacity can animate.
 *
 * Conventions (Desmos-like): rgb channels 0–255, hue in degrees, saturation /
 * value / lightness / alpha in 0–1. Out-of-range values are clamped.
 */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080',
  crimson: '#dc143c',
  transparent: '#00000000',
};

const clamp = (x: number, lo: number, hi: number) =>
  Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo;

function mk(r: number, g: number, b: number, a = 1): RGBA {
  return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: clamp(a, 0, 1) };
}

/** Parse `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` or a known colour name. */
export function parseColorLiteral(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  const hex = NAMED[s] ?? s;
  const m = /^#([0-9a-f]{3,8})$/.exec(hex);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return mk(n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1);
}

/** HSV (h in degrees, s/v in 0–1) → RGB 0–255. */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 60;
  const sc = clamp(s, 0, 1);
  const vc = clamp(v, 0, 1);
  const c = vc * sc;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = vc - c;
  const [r, g, b] =
    hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** HSL (h in degrees, s/l in 0–1) → RGB 0–255. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const lc = clamp(l, 0, 1);
  const sc = clamp(s, 0, 1);
  const v = lc + sc * Math.min(lc, 1 - lc);
  const sv = v === 0 ? 0 : 2 * (1 - lc / v);
  return hsvToRgb(h, sv, v);
}

/** Colour constructors available inside a colour expression. */
const COLOR_FNS = {
  rgb: (r: number, g: number, b: number) => mk(r, g, b),
  rgba: (r: number, g: number, b: number, a: number) => mk(r, g, b, a),
  hsv: (h: number, s: number, v: number) => mk(...hsvToRgb(h, s, v)),
  hsva: (h: number, s: number, v: number, a: number) => mk(...hsvToRgb(h, s, v), a),
  hsl: (h: number, s: number, l: number) => mk(...hslToRgb(h, s, l)),
  hsla: (h: number, s: number, l: number, a: number) => mk(...hslToRgb(h, s, l), a),
  gray: (v: number, a = 1) => mk(v * 255, v * 255, v * 255, a),
  // Blend two colours: mixc(c1, c2, u).
  mixc: (c1: RGBA, c2: RGBA, u: number) =>
    isRGBA(c1) && isRGBA(c2)
      ? mk(
          c1.r + (c2.r - c1.r) * u,
          c1.g + (c2.g - c1.g) * u,
          c1.b + (c2.b - c1.b) * u,
          c1.a + (c2.a - c1.a) * u,
        )
      : NaN,
  // Same colour, new alpha: alpha(c, a).
  alpha: (c: RGBA, a: number) => (isRGBA(c) ? mk(c.r, c.g, c.b, a) : NaN),
};

export const COLOR_FUNCTION_NAMES = Object.keys(COLOR_FNS);

function isRGBA(v: unknown): v is RGBA {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as RGBA).r === 'number' &&
    typeof (v as RGBA).g === 'number' &&
    typeof (v as RGBA).b === 'number' &&
    typeof (v as RGBA).a === 'number'
  );
}

// Hex literals inside an expression (mixc(#ff0000, #0000ff, u)) are rewritten
// to calls so mathjs can parse them.
function rewriteHex(expr: string): string {
  return expr.replace(/#([0-9a-fA-F]{3,8})\b/g, (_m, h: string) => {
    const c = parseColorLiteral('#' + h);
    return c ? `rgba(${c.r},${c.g},${c.b},${c.a})` : _m;
  });
}

interface CompiledColor {
  fn: EvalFunction;
  /** Called names that aren't built in — must be user functions in the scope. */
  extern: string[];
}
const compiled = new Map<string, CompiledColor | null>();

function compileColor(expr: string): CompiledColor | null {
  if (compiled.has(expr)) return compiled.get(expr)!;
  let fn: CompiledColor | null = null;
  try {
    const node = mjParse(rewriteHex(normalizeInput(expr)));
    const extern = [...calledFunctions(node)].filter((f) => !KNOWN_FUNCTIONS.has(f) && !(f in COLOR_FNS));
    fn = { fn: node.compile(), extern };
  } catch {
    fn = null;
  }
  if (compiled.size > 500) compiled.clear();
  compiled.set(expr, fn);
  return fn;
}

/**
 * Evaluate a colour (literal or expression) against a variable scope. Returns
 * null if it doesn't parse or doesn't produce a colour — callers fall back to
 * the entry's static colour.
 */
export function evalColor(expr: string | undefined, scope: Record<string, unknown> = {}): RGBA | null {
  if (!expr || !expr.trim()) return null;
  const lit = parseColorLiteral(expr);
  if (lit) return lit;
  const c = compileColor(expr.trim());
  if (!c) return null;
  // Colours come from untrusted links too: only built-ins, colour constructors
  // and the graph's own user functions may be called — never mathjs internals.
  if (c.extern.some((f) => typeof scope[f] !== 'function')) return null;
  try {
    const local = Object.create(scope) as Record<string, unknown>;
    Object.assign(local, COLOR_FNS);
    const v = c.fn.evaluate(local);
    return isRGBA(v) ? v : null;
  } catch {
    return null;
  }
}

/** Does this text parse as a colour expression at all (for input validation)? */
export function isColorExpr(expr: string): boolean {
  if (parseColorLiteral(expr)) return true;
  return compileColor(expr.trim()) !== null;
}

/** Names a colour expression calls that aren't built in (must be user functions). */
export function colorExprCalls(expr: string): string[] {
  if (parseColorLiteral(expr)) return [];
  return compileColor(expr.trim())?.extern ?? [];
}

/** CSS `rgba(...)` for a colour, optionally multiplying its alpha. */
export function toCss(c: RGBA, alphaMul = 1): string {
  const a = clamp(c.a * alphaMul, 0, 1);
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${+a.toFixed(4)})`;
}

/** `#rrggbb` for a colour (alpha dropped) — for the native colour input. */
export function toHex(c: RGBA): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}
