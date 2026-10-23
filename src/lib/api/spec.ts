import { parse as mjParse } from 'mathjs';
import { calledFunctions, freeSymbols, normalizeInput } from '../math/parse';
import { KNOWN_FUNCTIONS } from '../math/builtins';
import { latexToText } from '../math/fromlatex';
import { PALETTE, nextColor } from '../../utils/colors';
import type { GraphData } from '../graphFile';
import { isColorExpr } from '../color';
import type {
  AnimMode,
  Entry,
  FeatureToggles,
  LineStyle,
  PointDir,
  Projections,
  Viewport,
} from '../../store/types';

/**
 * The Fluxion graph spec: a small, stable, hand-writable JSON format for building
 * a graph from outside the app (LLM agents, scripts, docs). It is deliberately
 * decoupled from the internal `Entry` / `GraphData` shapes so those can evolve —
 * `specToGraph` / `graphToSpec` are the only bridges.
 *
 * Everything here is pure (no DOM), so it runs in the app, in Node (CLI) and in
 * tests. Incoming specs are untrusted: every field is type-checked, bounded and
 * copied (never spread) into the output, and expressions only ever reach the
 * existing mathjs parse pipeline.
 *
 * Documented for agents in public/llms.txt; JSON Schema in
 * public/fluxion-spec.schema.json (kept in sync by spec.test.ts).
 */

export const SPEC_VERSION = 1;

export const LIMITS = {
  /** Max expressions in one graph. Each one is sampled on every recompute. */
  maxExpressions: 100,
  /** Max characters in one expression. */
  maxExprLength: 1000,
  maxLabelLength: 100,
  /** Max initial-condition values (= ODE order). */
  maxIcLength: 10,
  /** Max |value| of any coordinate / slider bound. */
  maxAbs: 1e9,
  /** Max |θ| and max θ-span (50 turns) — the polar-region test loops per turn. */
  maxThetaAbs: 1e4,
  maxThetaSpan: 100 * Math.PI,
  /** Max length of a constant-expression string such as "2*pi". */
  maxConstLength: 100,
  /** Max serialized spec size accepted from a link / file (bytes of JSON). */
  maxSpecBytes: 200_000,
  /** Slider play speed (1 = a full sweep in ~4 s). Tiny speeds play long clips in real time. */
  minSpeed: 1e-4,
  maxSpeed: 100,
  /** Stroke width in px, and max length of a colour expression like "hsv(360*a, 1, 1)". */
  maxLineWidth: 20,
  maxColorExprLength: 200,
  /** Frame-sequence assets carried by a graph file (imported clips). */
  maxAssets: 8,
  maxAssetChars: 8_000_000,
  maxAssetsTotalChars: 16_000_000,
} as const;

export type DragMode = NonNullable<Entry['pointDrag']>;

/** A number, or a constant math expression like "2*pi" or "-pi/2". */
export type NumLike = number | string;

export interface ExpressionSpec {
  /** Plain-text expression, e.g. "y = sin(x)", "y' = -k*y", "x^2 + y^2 = 9". */
  expr: string;
  /** "#rrggbb" / "#rgb" or a palette name (red, blue, green, purple, orange, black, pink, teal). */
  color?: string;
  hidden?: boolean;
  /** ODE: initial time and state [y(t0), y'(t0), …]. */
  t0?: NumLike;
  ic?: NumLike | NumLike[];
  /** Slider (variable `k = 2`): bounds, step, play-button mode and speed. */
  min?: NumLike;
  max?: NumLike;
  step?: NumLike;
  anim?: AnimMode;
  speed?: number;
  /** Polar curve / polar region: θ sweep. */
  thetaMin?: NumLike;
  thetaMax?: NumLike;
  /** Points: label (LaTeX), its direction, marker radius px, drag behaviour. */
  label?: string;
  labelDir?: PointDir;
  pointSize?: number;
  drag?: DragMode;
  /** Style: stroke width px (0 hides it), dash style, fill for closed shapes / regions. */
  lineWidth?: number;
  lineStyle?: LineStyle;
  fill?: boolean;
  fillOpacity?: number;
  /** Colour expressions over sliders, e.g. "hsv(360*a, 0.8, 1)", "rgba(0,0,0,k)". */
  colorExpr?: string;
  fillColor?: string;
  /** Slider: start playing when the graph opens. */
  autoplay?: boolean;
}

export interface ViewportSpec {
  xmin?: NumLike;
  xmax?: NumLike;
  ymin?: NumLike;
  ymax?: NumLike;
}

export interface PanelsSpec {
  /** Right panel: values of every curve at x = sliceX. */
  right?: boolean;
  /** Bottom panel: where each curve crosses y = sliceY. */
  bottom?: boolean;
  /** A number, or an expression over sliders (e.g. "k") that drives the cut. */
  sliceX?: NumLike;
  sliceY?: NumLike;
}

export interface FluxionSpec {
  $schema?: string;
  version?: number;
  expressions: (string | ExpressionSpec)[];
  viewport?: ViewportSpec;
  features?: Partial<FeatureToggles>;
  panels?: PanelsSpec;
  sigFigs?: number;
}

/** A validated spec with every number resolved and every expression an object. */
export interface NormalizedExpression {
  expr: string;
  color: string;
  hidden: boolean;
  t0?: number;
  ic?: number[];
  min?: number;
  max?: number;
  step?: number;
  anim?: AnimMode;
  speed?: number;
  thetaMin?: number;
  thetaMax?: number;
  label?: string;
  labelDir?: PointDir;
  pointSize?: number;
  drag?: DragMode;
  lineWidth?: number;
  lineStyle?: LineStyle;
  fill?: boolean;
  fillOpacity?: number;
  colorExpr?: string;
  fillColor?: string;
  autoplay?: boolean;
}

export interface NormalizedSpec {
  version: 1;
  expressions: NormalizedExpression[];
  viewport: Viewport;
  features: FeatureToggles;
  projections: Projections;
  sigFigs: number;
}

export interface Issue {
  /** JSON-path-ish location, e.g. "expressions[2].ic". */
  path: string;
  message: string;
}

export type ValidateResult =
  | { ok: true; spec: NormalizedSpec; warnings: Issue[] }
  | { ok: false; errors: Issue[]; warnings: Issue[] };

// Defaults mirror store/useStore.ts (asserted equal in spec.test.ts).
export const DEFAULT_VIEWPORT: Viewport = { tMin: -8, tMax: 8, yMin: -5, yMax: 5 };
export const DEFAULT_FEATURES: FeatureToggles = {
  extrema: true,
  xIntercepts: true,
  yIntercept: true,
  endpoints: false,
  discontinuities: true,
  intersections: true,
};
export const DEFAULT_PROJECTIONS: Projections = {
  rightOpen: true,
  bottomOpen: true,
  sliceT: 0,
  sliceY: 1,
};
export const DEFAULT_SIG_FIGS = 3;

export const COLOR_NAMES: Record<string, string> = {
  red: PALETTE[0],
  blue: PALETTE[1],
  green: PALETTE[2],
  purple: PALETTE[3],
  orange: PALETTE[4],
  black: PALETTE[5],
  pink: PALETTE[6],
  teal: PALETTE[7],
};

export const ANIM_MODES: readonly AnimMode[] = ['loop', 'bounce', 'once'];
export const POINT_DIRS: readonly PointDir[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
export const DRAG_MODES: readonly DragMode[] = ['auto', 'off', 'x', 'y', 'both'];
export const LINE_STYLES: readonly LineStyle[] = ['solid', 'dashed', 'dotted'];

export const TOP_KEYS = [
  '$schema',
  'version',
  'expressions',
  'viewport',
  'features',
  'panels',
  'sigFigs',
] as const;
export const EXPRESSION_KEYS = [
  'expr',
  'color',
  'hidden',
  't0',
  'ic',
  'min',
  'max',
  'step',
  'anim',
  'speed',
  'thetaMin',
  'thetaMax',
  'label',
  'labelDir',
  'pointSize',
  'drag',
  'lineWidth',
  'lineStyle',
  'fill',
  'fillOpacity',
  'colorExpr',
  'fillColor',
  'autoplay',
] as const;
export const VIEWPORT_KEYS = ['xmin', 'xmax', 'ymin', 'ymax'] as const;
/** Feature toggles a spec may set; `grid` (grid lines + axes) defaults to shown. */
export const FEATURE_KEYS = [...Object.keys(DEFAULT_FEATURES), 'grid'] as (keyof FeatureToggles)[];
export const PANEL_KEYS = ['right', 'bottom', 'sliceX', 'sliceY'] as const;

/** Common mistakes → the key that was probably meant. */
const KEY_ALIASES: Record<string, string> = {
  expression: 'expr',
  latex: 'expr',
  equation: 'expr',
  formula: 'expr',
  colour: 'color',
  visible: 'hidden',
  hide: 'hidden',
  x0: 't0',
  tstart: 't0',
  y0: 'ic',
  initial: 'ic',
  init: 'ic',
  initialconditions: 'ic',
  mode: 'anim',
  animmode: 'anim',
  animation: 'anim',
  thetamin: 'thetaMin',
  thetamax: 'thetaMax',
  size: 'pointSize',
  width: 'lineWidth',
  linewidth: 'lineWidth',
  thickness: 'lineWidth',
  dash: 'lineStyle',
  style: 'lineStyle',
  opacity: 'fillOpacity',
  colour_expr: 'colorExpr',
  colorexpression: 'colorExpr',
  fillcolour: 'fillColor',
  play: 'autoplay',
  tmin: 'xmin',
  tmax: 'xmax',
  left: 'xmin',
  right: 'xmax',
  bottom: 'ymin',
  top: 'ymax',
  exprs: 'expressions',
  entries: 'expressions',
  equations: 'expressions',
  window: 'viewport',
  bounds: 'viewport',
  view: 'viewport',
  sigfigs: 'sigFigs',
  precision: 'sigFigs',
};

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

/** "Did you mean …?" for an unknown key, or '' if nothing is close. */
export function suggestKey(key: string, allowed: readonly string[]): string {
  const lower = key.toLowerCase().replace(/[_\s-]/g, '');
  const ci = allowed.find((k) => k.toLowerCase() === lower);
  if (ci) return ci;
  const alias = KEY_ALIASES[lower];
  if (alias && allowed.includes(alias)) return alias;
  let best = '';
  let bestD = 3;
  for (const k of allowed) {
    const d = editDistance(lower, k.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'string') return `the string ${JSON.stringify(v.length > 40 ? v.slice(0, 40) + '…' : v)}`;
  return typeof v === 'object' ? 'an object' : `${typeof v} ${String(v)}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Evaluate a constant like 2, "2*pi", "-pi/2", "sqrt(2)", "1e-3". Strings go
 * through the same normaliser + mathjs parser as expressions and may not
 * reference any variable. Returns a number, or an error message.
 */
export function evalConstant(v: unknown): number | string {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 'must be a finite number';
  if (typeof v !== 'string') return `must be a number or a constant like "2*pi", got ${describe(v)}`;
  const s = v.trim();
  if (!s) return 'must not be empty';
  if (s.length > LIMITS.maxConstLength) return `is too long (max ${LIMITS.maxConstLength} chars)`;
  try {
    const node = mjParse(normalizeInput(s));
    const free = [...freeSymbols(node)];
    if (free.length) return `must be a constant, but "${s}" uses ${free.join(', ')}`;
    // `t` is reserved (so not in freeSymbols) but is not a constant either.
    let usesT = false;
    node.traverse((n) => {
      if ((n as { type?: string }).type === 'SymbolNode' && (n as unknown as { name: string }).name === 't') usesT = true;
    });
    if (usesT) return `must be a constant, but "${s}" uses t`;
    const unknown = [...calledFunctions(node)].filter((f) => !KNOWN_FUNCTIONS.has(f));
    if (unknown.length) return `"${s}" calls unknown function ${unknown.join(', ')}`;
    const val = node.compile().evaluate({});
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    return `"${s}" does not evaluate to a finite real number`;
  } catch (err) {
    return `"${s}" is not a valid constant (${err instanceof Error ? err.message : String(err)})`;
  }
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Canonical "#rrggbb" for a hex or palette-name colour, or null if invalid. */
export function resolveColor(c: string): string | null {
  const named = COLOR_NAMES[c.trim().toLowerCase()];
  if (named) return named;
  const s = c.trim();
  if (!HEX_COLOR.test(s)) return null;
  if (s.length === 4) return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
  return s.toLowerCase();
}

/**
 * Light, lossless clean-up of an expression written by an agent: LaTeX (anything
 * with a backslash command) is converted with the app's own LaTeX bridge.
 * Returns the text and whether it was converted.
 */
export function cleanExpr(expr: string): { text: string; fromLatex: boolean } {
  if (/\\[A-Za-z]/.test(expr)) return { text: latexToText(expr), fromLatex: true };
  return { text: expr.trim(), fromLatex: false };
}

/** Is `expr` parseable and free of calls to unknown functions? (safe to evaluate) */
export function isSafeExpression(expr: string): boolean {
  try {
    return [...calledFunctions(mjParse(normalizeInput(expr)))].every((f) => KNOWN_FUNCTIONS.has(f));
  } catch {
    return false;
  }
}

class Collector {
  errors: Issue[] = [];
  warnings: Issue[] = [];
  error(path: string, message: string) {
    this.errors.push({ path, message });
  }
  warn(path: string, message: string) {
    this.warnings.push({ path, message });
  }
  /** Report keys of `obj` that aren't in `allowed` as errors with a suggestion. */
  unknownKeys(obj: Record<string, unknown>, allowed: readonly string[], path: string) {
    for (const k of Object.keys(obj)) {
      if (allowed.includes(k)) continue;
      const s = suggestKey(k, allowed);
      this.error(
        path ? `${path}.${k}` : k,
        `unknown key "${k}"` + (s ? ` (did you mean "${s}"?)` : '') + `. Allowed: ${allowed.join(', ')}.`,
      );
    }
  }
  num(v: unknown, path: string, opts: { min?: number; max?: number; abs?: number } = {}): number | undefined {
    const r = evalConstant(v);
    if (typeof r === 'string') {
      this.error(path, r);
      return undefined;
    }
    const abs = opts.abs ?? LIMITS.maxAbs;
    if (Math.abs(r) > abs) {
      this.error(path, `must be within ±${abs}`);
      return undefined;
    }
    if (opts.min !== undefined && r < opts.min) {
      this.error(path, `must be ≥ ${opts.min}`);
      return undefined;
    }
    if (opts.max !== undefined && r > opts.max) {
      this.error(path, `must be ≤ ${opts.max}`);
      return undefined;
    }
    return r;
  }
  bool(v: unknown, path: string): boolean | undefined {
    if (typeof v === 'boolean') return v;
    this.error(path, `must be true or false, got ${describe(v)}`);
    return undefined;
  }
  oneOf<T extends string>(v: unknown, options: readonly T[], path: string): T | undefined {
    if (typeof v === 'string' && (options as readonly string[]).includes(v)) return v as T;
    this.error(path, `must be one of ${options.map((o) => `"${o}"`).join(', ')}, got ${describe(v)}`);
    return undefined;
  }
}

function validateExpression(
  item: unknown,
  path: string,
  c: Collector,
): Omit<NormalizedExpression, 'color'> & { color?: string } | undefined {
  const obj: Record<string, unknown> | undefined =
    typeof item === 'string' ? { expr: item } : isPlainObject(item) ? item : undefined;
  if (!obj) {
    c.error(path, `must be a string like "y = sin(x)" or an object {"expr": …}, got ${describe(item)}`);
    return undefined;
  }
  c.unknownKeys(obj, EXPRESSION_KEYS, path);

  const exprPath = typeof item === 'string' ? path : `${path}.expr`;
  if (typeof obj.expr !== 'string') {
    c.error(exprPath, obj.expr === undefined ? 'missing "expr"' : `"expr" must be a string, got ${describe(obj.expr)}`);
    return undefined;
  }
  if (obj.expr.length > LIMITS.maxExprLength) {
    c.error(exprPath, `expression is too long (max ${LIMITS.maxExprLength} chars)`);
    return undefined;
  }
  const { text, fromLatex } = cleanExpr(obj.expr);
  if (fromLatex) {
    c.warn(exprPath, `looks like LaTeX; converted to plain text "${text}". Prefer plain text.`);
  }
  if (!text) c.warn(exprPath, 'expression is empty');

  const out: Omit<NormalizedExpression, 'color'> & { color?: string } = { expr: text, hidden: false };

  if (obj.color !== undefined) {
    if (typeof obj.color !== 'string' || !resolveColor(obj.color)) {
      c.error(
        `${path}.color`,
        `must be "#rrggbb", "#rgb" or one of ${Object.keys(COLOR_NAMES).join(', ')}, got ${describe(obj.color)}`,
      );
    } else out.color = resolveColor(obj.color)!;
  }
  if (obj.hidden !== undefined) {
    const b = c.bool(obj.hidden, `${path}.hidden`);
    if (b !== undefined) out.hidden = b;
  }
  if (obj.t0 !== undefined) out.t0 = c.num(obj.t0, `${path}.t0`);
  if (obj.ic !== undefined) {
    const arr = Array.isArray(obj.ic) ? obj.ic : [obj.ic];
    if (arr.length === 0) c.error(`${path}.ic`, 'must not be empty');
    else if (arr.length > LIMITS.maxIcLength) c.error(`${path}.ic`, `at most ${LIMITS.maxIcLength} values`);
    else {
      const vals = arr.map((v, i) => c.num(v, Array.isArray(obj.ic) ? `${path}.ic[${i}]` : `${path}.ic`));
      if (vals.every((v): v is number => v !== undefined)) out.ic = vals;
    }
  }
  if (obj.min !== undefined) out.min = c.num(obj.min, `${path}.min`);
  if (obj.max !== undefined) out.max = c.num(obj.max, `${path}.max`);
  if (out.min !== undefined && out.max !== undefined && !(out.min < out.max)) {
    c.error(`${path}.max`, `must be greater than min (${out.min})`);
  }
  if (obj.step !== undefined) {
    const s = c.num(obj.step, `${path}.step`);
    if (s !== undefined && !(s > 0)) c.error(`${path}.step`, 'must be > 0');
    else out.step = s;
  }
  if (obj.anim !== undefined) out.anim = c.oneOf(obj.anim, ANIM_MODES, `${path}.anim`);
  if (obj.speed !== undefined) {
    out.speed = c.num(obj.speed, `${path}.speed`, { min: LIMITS.minSpeed, max: LIMITS.maxSpeed });
  }
  if (obj.thetaMin !== undefined) {
    out.thetaMin = c.num(obj.thetaMin, `${path}.thetaMin`, { abs: LIMITS.maxThetaAbs });
  }
  if (obj.thetaMax !== undefined) {
    out.thetaMax = c.num(obj.thetaMax, `${path}.thetaMax`, { abs: LIMITS.maxThetaAbs });
  }
  {
    const lo = out.thetaMin ?? 0;
    const hi = out.thetaMax ?? Math.PI * 2;
    if ((out.thetaMin !== undefined || out.thetaMax !== undefined) && Number.isFinite(lo) && Number.isFinite(hi)) {
      if (!(lo < hi)) c.error(`${path}.thetaMax`, `must be greater than thetaMin (${lo})`);
      else if (hi - lo > LIMITS.maxThetaSpan) {
        c.error(`${path}.thetaMax`, `θ range may span at most 50 turns (100*pi)`);
      }
    }
  }
  if (obj.label !== undefined) {
    if (typeof obj.label !== 'string') c.error(`${path}.label`, `must be a string, got ${describe(obj.label)}`);
    else if (obj.label.length > LIMITS.maxLabelLength) {
      c.error(`${path}.label`, `is too long (max ${LIMITS.maxLabelLength} chars)`);
    } else out.label = obj.label;
  }
  if (obj.labelDir !== undefined) out.labelDir = c.oneOf(obj.labelDir, POINT_DIRS, `${path}.labelDir`);
  if (obj.pointSize !== undefined) {
    const n = c.num(obj.pointSize, `${path}.pointSize`, { min: 2, max: 14 });
    if (n !== undefined) out.pointSize = n;
  }
  if (obj.drag !== undefined) out.drag = c.oneOf(obj.drag, DRAG_MODES, `${path}.drag`);
  if (obj.lineWidth !== undefined) {
    out.lineWidth = c.num(obj.lineWidth, `${path}.lineWidth`, { min: 0, max: LIMITS.maxLineWidth });
  }
  if (obj.lineStyle !== undefined) out.lineStyle = c.oneOf(obj.lineStyle, LINE_STYLES, `${path}.lineStyle`);
  if (obj.fill !== undefined) out.fill = c.bool(obj.fill, `${path}.fill`);
  if (obj.fillOpacity !== undefined) {
    out.fillOpacity = c.num(obj.fillOpacity, `${path}.fillOpacity`, { min: 0, max: 1 });
  }
  for (const k of ['colorExpr', 'fillColor'] as const) {
    const v = obj[k];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !v.trim()) c.error(`${path}.${k}`, `must be a colour string, got ${describe(v)}`);
    else if (v.length > LIMITS.maxColorExprLength) {
      c.error(`${path}.${k}`, `is too long (max ${LIMITS.maxColorExprLength} chars)`);
    } else if (!isColorExpr(v)) {
      c.error(`${path}.${k}`, `"${v}" is not a colour: use "#rrggbb", rgb(r,g,b) (0–255), rgba(r,g,b,a), hsv(h,s,v) or hsl(h,s,l) (h in degrees, s/v/l/a in 0–1)`);
    } else out[k] = v.trim();
  }
  if (obj.autoplay !== undefined) out.autoplay = c.bool(obj.autoplay, `${path}.autoplay`);

  // Drop keys whose value failed validation (left as undefined above).
  for (const k of Object.keys(out) as (keyof typeof out)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/**
 * Strictly validate an untrusted spec. On success returns a normalised copy
 * (numbers resolved, colours assigned, defaults filled). Errors carry a path and
 * a human/LLM-friendly message; warnings never block loading.
 */
export function validateSpec(input: unknown): ValidateResult {
  const c = new Collector();
  let obj: unknown = input;
  if (Array.isArray(input)) {
    // Convenience: a bare array of expressions.
    obj = { expressions: input };
  }
  if (!isPlainObject(obj)) {
    c.error('', `spec must be a JSON object like {"expressions": ["y = sin(x)"]}, got ${describe(input)}`);
    return { ok: false, errors: c.errors, warnings: c.warnings };
  }
  c.unknownKeys(obj, TOP_KEYS, '');

  if (obj.version !== undefined && obj.version !== SPEC_VERSION) {
    c.error(
      'version',
      typeof obj.version === 'number' && obj.version > SPEC_VERSION
        ? `spec version ${obj.version} is newer than this Fluxion supports (${SPEC_VERSION})`
        : `must be ${SPEC_VERSION}`,
    );
  }
  if (obj.$schema !== undefined && typeof obj.$schema !== 'string') c.error('$schema', 'must be a string');

  const expressions: (Omit<NormalizedExpression, 'color'> & { color?: string })[] = [];
  if (!Array.isArray(obj.expressions)) {
    c.error(
      'expressions',
      obj.expressions === undefined
        ? 'missing "expressions" (an array like ["y = sin(x)"])'
        : `must be an array, got ${describe(obj.expressions)}`,
    );
  } else if (obj.expressions.length > LIMITS.maxExpressions) {
    c.error('expressions', `too many expressions (${obj.expressions.length}; max ${LIMITS.maxExpressions})`);
  } else {
    if (obj.expressions.length === 0) c.warn('expressions', 'no expressions — the graph will be empty');
    obj.expressions.forEach((item, i) => {
      const e = validateExpression(item, `expressions[${i}]`, c);
      if (e) expressions.push(e);
    });
  }

  // Viewport (x is the horizontal axis; internally it's called t).
  const vp: Viewport = { ...DEFAULT_VIEWPORT };
  if (obj.viewport !== undefined) {
    if (!isPlainObject(obj.viewport)) {
      c.error('viewport', `must be an object like {"xmin": -10, "xmax": 10, "ymin": -5, "ymax": 5}`);
    } else {
      const v = obj.viewport;
      c.unknownKeys(v, VIEWPORT_KEYS, 'viewport');
      const map = { xmin: 'tMin', xmax: 'tMax', ymin: 'yMin', ymax: 'yMax' } as const;
      for (const k of VIEWPORT_KEYS) {
        if (v[k] === undefined) continue;
        const n = c.num(v[k], `viewport.${k}`);
        if (n !== undefined) vp[map[k]] = n;
      }
      // A one-sided range keeps the default span on the other side.
      if (v.xmin !== undefined && v.xmax === undefined && vp.tMin >= vp.tMax) vp.tMax = vp.tMin + 16;
      if (v.xmax !== undefined && v.xmin === undefined && vp.tMin >= vp.tMax) vp.tMin = vp.tMax - 16;
      if (v.ymin !== undefined && v.ymax === undefined && vp.yMin >= vp.yMax) vp.yMax = vp.yMin + 10;
      if (v.ymax !== undefined && v.ymin === undefined && vp.yMin >= vp.yMax) vp.yMin = vp.yMax - 10;
      if (!(vp.tMax - vp.tMin > 1e-9)) c.error('viewport.xmax', 'must be greater than xmin');
      if (!(vp.yMax - vp.yMin > 1e-9)) c.error('viewport.ymax', 'must be greater than ymin');
    }
  }

  const features: FeatureToggles = { ...DEFAULT_FEATURES };
  if (obj.features !== undefined) {
    if (!isPlainObject(obj.features)) c.error('features', 'must be an object of booleans');
    else {
      c.unknownKeys(obj.features, FEATURE_KEYS, 'features');
      for (const k of FEATURE_KEYS) {
        if (obj.features[k] === undefined) continue;
        const b = c.bool(obj.features[k], `features.${k}`);
        if (b !== undefined) features[k] = b;
      }
    }
  }

  const projections: Projections = { ...DEFAULT_PROJECTIONS };
  if (obj.panels !== undefined) {
    if (!isPlainObject(obj.panels)) c.error('panels', 'must be an object like {"right": false, "bottom": false}');
    else {
      const p = obj.panels;
      c.unknownKeys(p, PANEL_KEYS, 'panels');
      if (p.right !== undefined) {
        const b = c.bool(p.right, 'panels.right');
        if (b !== undefined) projections.rightOpen = b;
      }
      if (p.bottom !== undefined) {
        const b = c.bool(p.bottom, 'panels.bottom');
        if (b !== undefined) projections.bottomOpen = b;
      }
      for (const [k, numKey, exprKey] of [
        ['sliceX', 'sliceT', 'sliceTExpr'],
        ['sliceY', 'sliceY', 'sliceYExpr'],
      ] as const) {
        const val = p[k];
        if (val === undefined) continue;
        const r = evalConstant(val);
        if (typeof r === 'number' && Math.abs(r) <= LIMITS.maxAbs) projections[numKey] = r;
        else if (typeof val === 'string' && val.trim() && val.length <= LIMITS.maxConstLength) {
          // Not a constant: an expression over sliders, resolved live by the app.
          try {
            const node = mjParse(normalizeInput(val));
            const unknown = [...calledFunctions(node)].filter((f) => !KNOWN_FUNCTIONS.has(f));
            if (unknown.length) c.error(`panels.${k}`, `calls unknown function ${unknown.join(', ')}`);
            else projections[exprKey] = val.trim();
          } catch {
            c.error(`panels.${k}`, `"${val}" is not a valid number or expression`);
          }
        } else c.error(`panels.${k}`, typeof r === 'string' ? r : `must be within ±${LIMITS.maxAbs}`);
      }
    }
  }

  let sigFigs = DEFAULT_SIG_FIGS;
  if (obj.sigFigs !== undefined) {
    const n = c.num(obj.sigFigs, 'sigFigs', { min: 1, max: 12 });
    if (n !== undefined) sigFigs = Math.round(n);
  }

  if (c.errors.length) return { ok: false, errors: c.errors, warnings: c.warnings };

  // Assign palette colours in order to expressions that didn't pick one,
  // skipping colours already chosen explicitly (same rule as the app's "add").
  const used: string[] = expressions.filter((e) => e.color).map((e) => e.color!);
  const assigned: string[] = [];
  const normalized: NormalizedExpression[] = expressions.map((e) => {
    let color = e.color;
    if (!color) {
      color = nextColor([...used, ...assigned]);
      assigned.push(color);
    }
    return { ...e, color };
  });

  return {
    ok: true,
    spec: { version: 1, expressions: normalized, viewport: vp, features, projections, sigFigs },
    warnings: c.warnings,
  };
}

/** Build the app's GraphData from a validated spec. */
export function specToGraph(spec: NormalizedSpec): GraphData {
  const entries: Entry[] = spec.expressions.map((e, i) => {
    const entry: Entry = {
      id: `api-${i + 1}`,
      raw: e.expr,
      color: e.color,
      visible: !e.hidden,
      expanded: true,
    };
    if (e.t0 !== undefined) entry.t0 = e.t0;
    if (e.ic !== undefined) entry.ic = e.ic.slice();
    if (e.min !== undefined) entry.varMin = e.min;
    if (e.max !== undefined) entry.varMax = e.max;
    if (e.step !== undefined) entry.varStep = e.step;
    if (e.anim !== undefined) entry.animMode = e.anim;
    if (e.speed !== undefined) entry.animSpeed = e.speed;
    if (e.thetaMin !== undefined) entry.thetaMin = e.thetaMin;
    if (e.thetaMax !== undefined) entry.thetaMax = e.thetaMax;
    if (e.label !== undefined) entry.pointLabel = e.label;
    if (e.labelDir !== undefined) entry.pointLabelDir = e.labelDir;
    if (e.pointSize !== undefined) entry.pointSize = e.pointSize;
    if (e.drag !== undefined) entry.pointDrag = e.drag;
    if (e.lineWidth !== undefined) entry.lineWidth = e.lineWidth;
    if (e.lineStyle !== undefined) entry.lineStyle = e.lineStyle;
    if (e.fill !== undefined) entry.fill = e.fill;
    if (e.fillOpacity !== undefined) entry.fillOpacity = e.fillOpacity;
    if (e.colorExpr !== undefined) entry.colorExpr = e.colorExpr;
    if (e.fillColor !== undefined) entry.fillColor = e.fillColor;
    if (e.autoplay) entry.autoplay = true;
    return entry;
  });
  return {
    v: 1,
    entries,
    viewport: { ...spec.viewport },
    features: { ...spec.features },
    projections: { ...spec.projections },
    sigFigs: spec.sigFigs,
  };
}

function sameObj<T extends object>(a: T, b: T): boolean {
  return (Object.keys(b) as (keyof T)[]).every((k) => a[k] === b[k]);
}

/**
 * Inverse of specToGraph: express an app graph as a minimal, readable spec
 * (defaults omitted, auto-assignable colours omitted, string shorthand where
 * possible). Used for "Copy as JSON spec" and to decode share links.
 */
export function graphToSpec(g: Pick<GraphData, 'entries' | 'viewport'> & Partial<GraphData>): FluxionSpec {
  const live = g.entries.filter((e) => e.raw.trim() !== '');
  // Which colour would auto-assignment pick for each entry? Explicit colours are
  // those that differ; mirror validateSpec's assignment to decide.
  // Marking one explicit changes the pool for the rest, so mark only the first
  // mismatch per pass and re-simulate (≤ n passes).
  const explicit = live.map((e) => !(PALETTE as readonly string[]).includes(e.color.toLowerCase()));
  for (;;) {
    const used = live.filter((_, i) => explicit[i]).map((e) => e.color.toLowerCase());
    const assigned: string[] = [];
    const miss = live.findIndex((e, i) => {
      if (explicit[i]) return false;
      const auto = nextColor([...used, ...assigned]);
      assigned.push(auto);
      return auto !== e.color.toLowerCase();
    });
    if (miss < 0) break;
    explicit[miss] = true;
  }

  const expressions = live.map((e, i): string | ExpressionSpec => {
    const x: ExpressionSpec = { expr: e.raw };
    if (explicit[i]) x.color = e.color;
    if (!e.visible) x.hidden = true;
    if (e.t0 !== undefined) x.t0 = e.t0;
    if (e.ic !== undefined && e.ic.length) x.ic = e.ic.slice();
    if (e.varMin !== undefined) x.min = e.varMin;
    if (e.varMax !== undefined) x.max = e.varMax;
    if (e.varStep !== undefined) x.step = e.varStep;
    if (e.animMode !== undefined) x.anim = e.animMode;
    if (e.animSpeed !== undefined) x.speed = e.animSpeed;
    if (e.thetaMin !== undefined) x.thetaMin = e.thetaMin;
    if (e.thetaMax !== undefined) x.thetaMax = e.thetaMax;
    if (e.pointLabel) x.label = e.pointLabel;
    if (e.pointLabelDir !== undefined) x.labelDir = e.pointLabelDir;
    if (e.pointSize !== undefined) x.pointSize = e.pointSize;
    if (e.pointDrag !== undefined) x.drag = e.pointDrag;
    if (e.lineWidth !== undefined) x.lineWidth = e.lineWidth;
    if (e.lineStyle !== undefined) x.lineStyle = e.lineStyle;
    if (e.fill !== undefined) x.fill = e.fill;
    if (e.fillOpacity !== undefined) x.fillOpacity = e.fillOpacity;
    if (e.colorExpr) x.colorExpr = e.colorExpr;
    if (e.fillColor) x.fillColor = e.fillColor;
    if (e.autoplay) x.autoplay = true;
    // A slider's current value lives in varValue; fold it back into the text.
    if (e.varValue !== undefined) {
      const m = e.raw.match(/^\s*([A-Za-z]\w*)\s*=/);
      if (m) x.expr = `${m[1]} = ${e.varValue}`;
    }
    return Object.keys(x).length === 1 ? x.expr : x;
  });

  const spec: FluxionSpec = { version: SPEC_VERSION, expressions };
  const vp = g.viewport;
  if (!sameObj(vp, DEFAULT_VIEWPORT)) {
    spec.viewport = { xmin: vp.tMin, xmax: vp.tMax, ymin: vp.yMin, ymax: vp.yMax };
  }
  if (g.features) {
    // grid is optional (undefined = shown), so compare effective values.
    const eff = (fs: Partial<FeatureToggles>, k: keyof FeatureToggles) => (k === 'grid' ? fs[k] !== false : !!fs[k]);
    const f: Partial<FeatureToggles> = {};
    for (const k of FEATURE_KEYS) if (eff(g.features, k) !== eff(DEFAULT_FEATURES, k)) f[k] = eff(g.features, k);
    if (Object.keys(f).length) spec.features = f;
  }
  const p = g.projections;
  if (p) {
    const panels: PanelsSpec = {};
    if (p.rightOpen !== DEFAULT_PROJECTIONS.rightOpen) panels.right = p.rightOpen;
    if (p.bottomOpen !== DEFAULT_PROJECTIONS.bottomOpen) panels.bottom = p.bottomOpen;
    if (p.sliceTExpr) panels.sliceX = p.sliceTExpr;
    else if (p.sliceT !== DEFAULT_PROJECTIONS.sliceT) panels.sliceX = p.sliceT;
    if (p.sliceYExpr) panels.sliceY = p.sliceYExpr;
    else if (p.sliceY !== DEFAULT_PROJECTIONS.sliceY) panels.sliceY = p.sliceY;
    if (Object.keys(panels).length) spec.panels = panels;
  }
  if (g.sigFigs !== undefined && g.sigFigs !== DEFAULT_SIG_FIGS) spec.sigFigs = g.sigFigs;
  return spec;
}
