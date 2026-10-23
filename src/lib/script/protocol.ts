/**
 * Script mode wire format: what the sandboxed runtime sends back to the app,
 * and the validator that every message passes through before anything is drawn.
 *
 * The runtime (runtime.ts) runs untrusted user code inside a Web Worker in a
 * sandboxed iframe. Its output is a *display list*: plain JSON-ish data
 * (numbers, short strings, arrays) describing shapes in data coordinates. The
 * app never evaluates anything it receives; `sanitizeFrame` copies only known
 * fields with the right types, finite numbers and capped sizes, so a hostile
 * script can at worst draw something ugly or get its frame rejected.
 *
 * Pure (no DOM), shared by the worker, the app and the Node tests.
 */

export const SCRIPT_LIMITS = {
  /** Max characters of script source (store, links, files). */
  maxCodeChars: 100_000,
  /** Max display items per frame. */
  maxItems: 20_000,
  /** Max numbers across every item's geometry per frame (≈ 300k points). */
  maxNumbers: 600_000,
  /** Max characters of one text item / log line / error message. */
  maxText: 300,
  maxLogLine: 1_000,
  /** Max log lines kept per run. */
  maxLogs: 100,
  /** Max script sliders. */
  maxSliders: 32,
  /** Max slider / clip name length. */
  maxName: 32,
  /** Max imported clips a script can reference. */
  maxClips: 8,
  /** A colour / CSS string. */
  maxColor: 64,
  /** Gradient stops. */
  maxStops: 16,
  /** Dash pattern entries. */
  maxDash: 8,
  /** A run (first frame / edit) may take this long before the worker is killed. */
  runTimeoutMs: 3_000,
  /** One animation frame may take this long before the worker is killed. */
  frameTimeoutMs: 1_500,
  /** Soft per-frame budget: slower frames are reported as a warning. */
  frameBudgetMs: 40,
  /** Max |coordinate| accepted (data units). */
  maxAbs: 1e9,
  /** Max px for widths / sizes. */
  maxPx: 400,
} as const;

/** 2D affine matrix [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
export type Mat = [number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export interface GradientStop {
  offset: number;
  color: string;
}
export type Paint =
  | string
  | { type: 'linear'; x0: number; y0: number; x1: number; y1: number; stops: GradientStop[] }
  | { type: 'radial'; x0: number; y0: number; r0: number; x1: number; y1: number; r1: number; stops: GradientStop[] };

export interface ItemStyle {
  /** Stroke colour, or null for no outline. */
  stroke: string | null;
  /** Fill paint, or null for no fill. */
  fill: Paint | null;
  /** Stroke width in screen px. */
  width: number;
  /** Dash pattern in px ([] = solid). */
  dash: number[];
  /** 0…1, multiplies everything. */
  opacity: number;
  cap: 'round' | 'butt' | 'square';
  join: 'round' | 'miter' | 'bevel';
}

/** Path ops, flattened: an op code followed by its arguments. */
export const OP = {
  move: 0, // x y
  line: 1, // x y
  quad: 2, // cx cy x y
  cubic: 3, // c1x c1y c2x c2y x y
  close: 4, //
  ellipse: 5, // cx cy rx ry rotation a0 a1 ccw(0/1)
} as const;
export const OP_ARGS = [2, 2, 4, 6, 0, 8] as const;

export type DisplayItem =
  | { k: 'path'; ops: number[]; m: Mat; style: ItemStyle }
  | { k: 'point'; x: number; y: number; r: number; style: ItemStyle }
  | { k: 'arrow'; x1: number; y1: number; x2: number; y2: number; head: number; style: ItemStyle }
  | {
      k: 'text';
      x: number;
      y: number;
      text: string;
      size: number;
      align: 'left' | 'center' | 'right';
      baseline: 'top' | 'middle' | 'bottom' | 'alphabetic';
      font: 'sans' | 'serif' | 'mono';
      bold: boolean;
      angle: number;
      halo: boolean;
      style: ItemStyle;
    }
  | { k: 'clip'; id: string; frame: number; m: Mat; style: ItemStyle };

export interface SliderDecl {
  name: string;
  min: number;
  max: number;
  value: number;
  step: number;
}

export interface ScriptFrame {
  items: DisplayItem[];
  /** Full-canvas background colour (hides the grid), if the script set one. */
  background: string | null;
  sliders: SliderDecl[];
  logs: string[];
  /** Clock loop length in seconds, if the script called loop(). */
  loop: number | null;
  /** Wall time the script took for this frame (ms, measured in the worker). */
  ms: number;
  /** Does the script use the clock (time / frame / loop / clip.play)? */
  animated: boolean;
}

export interface ScriptError {
  message: string;
  /** 1-based line in the user's code, when known. */
  line?: number;
  column?: number;
}

/** Messages the runtime sends back. */
export type FromRuntime =
  | { type: 'ready' }
  | { type: 'frame'; id: number; frame: ScriptFrame }
  | { type: 'error'; id: number; error: ScriptError; frame?: ScriptFrame };

/** Data the app sends to the runtime (all plain data; nothing is code but `code`). */
export interface GraphEntryData {
  raw: string;
  visible: boolean;
  t0?: number;
  ic?: number[];
  varValue?: number;
}
export interface ClipMeta {
  name: string;
  id: string;
  frames: number;
  fps: number;
  box: [number, number, number, number];
}
export interface ScriptInputs {
  time: number;
  sliders: Record<string, number>;
  view: { xmin: number; xmax: number; ymin: number; ymax: number };
  theme: 'light' | 'dark';
}
export type ToRuntime =
  | { type: 'graph'; entries: GraphEntryData[]; clips: ClipMeta[] }
  | { type: 'compile'; code: string }
  | { type: 'run'; id: number; inputs: ScriptInputs };

// ── validation ────────────────────────────────────────────────────────────────

const L = SCRIPT_LIMITS;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const coord = (v: unknown): number => {
  if (!fin(v) || Math.abs(v) > L.maxAbs) throw new Error('bad number');
  return v;
};
const px = (v: unknown, dflt: number): number => (fin(v) ? Math.min(L.maxPx, Math.max(0, v)) : dflt);
const unit = (v: unknown, dflt: number): number => (fin(v) ? Math.min(1, Math.max(0, v)) : dflt);
const pick = <T extends string>(v: unknown, opts: readonly T[], dflt: T): T =>
  typeof v === 'string' && (opts as readonly string[]).includes(v) ? (v as T) : dflt;

// Colours reach canvas fillStyle / strokeStyle only. Canvas ignores anything it
// can't parse, but keep them to plain CSS colour syntax anyway.
const COLOR_RE =
  /^(?:#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla)\(\s*-?[\d.]+(?:e-?\d+)?%?(?:\s*[,\s/]\s*-?[\d.]+(?:e-?\d+)?%?){2,3}\s*\)|[a-zA-Z]{3,20})$/;
export function safeColor(v: unknown): string | null {
  return typeof v === 'string' && v.length <= L.maxColor && COLOR_RE.test(v.trim()) ? v.trim() : null;
}

function stops(v: unknown): GradientStop[] {
  if (!Array.isArray(v) || v.length < 1) throw new Error('bad gradient');
  return v.slice(0, L.maxStops).map((s) => {
    if (!isObj(s)) throw new Error('bad gradient stop');
    const color = safeColor(s.color);
    if (!color) throw new Error('bad gradient colour');
    return { offset: unit(s.offset, 0), color };
  });
}

function paint(v: unknown): Paint | null {
  if (v == null) return null;
  if (typeof v === 'string') return safeColor(v);
  if (!isObj(v)) return null;
  if (v.type === 'linear') {
    return { type: 'linear', x0: coord(v.x0), y0: coord(v.y0), x1: coord(v.x1), y1: coord(v.y1), stops: stops(v.stops) };
  }
  if (v.type === 'radial') {
    return {
      type: 'radial',
      x0: coord(v.x0),
      y0: coord(v.y0),
      r0: Math.abs(coord(v.r0)),
      x1: coord(v.x1),
      y1: coord(v.y1),
      r1: Math.abs(coord(v.r1)),
      stops: stops(v.stops),
    };
  }
  return null;
}

function style(v: unknown): ItemStyle {
  const s = isObj(v) ? v : {};
  const dash = Array.isArray(s.dash) ? s.dash.slice(0, L.maxDash).map((d) => px(d, 0)) : [];
  return {
    stroke: s.stroke == null ? null : safeColor(s.stroke),
    fill: paint(s.fill),
    width: px(s.width, 2),
    dash: dash.some((d) => d > 0) ? dash : [],
    opacity: unit(s.opacity, 1),
    cap: pick(s.cap, ['round', 'butt', 'square'] as const, 'round'),
    join: pick(s.join, ['round', 'miter', 'bevel'] as const, 'round'),
  };
}

function mat(v: unknown): Mat {
  if (!Array.isArray(v) || v.length !== 6) throw new Error('bad matrix');
  return v.map(coord) as Mat;
}

function text(v: unknown, max: number): string {
  // Strip control characters (keeps tabs/newlines out of canvas text).
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '';
}

const ASSET_ID = /^fx[0-9a-f]{8}[0-9a-z]{1,10}$/;

/** Validate one display item; throws on anything malformed. Returns its numeric cost. */
function item(v: unknown, budget: { n: number }): DisplayItem {
  if (!isObj(v)) throw new Error('bad item');
  const spend = (n: number) => {
    budget.n -= n;
    if (budget.n < 0) throw new Error(`too much geometry (over ${L.maxNumbers.toLocaleString('en')} numbers)`);
  };
  switch (v.k) {
    case 'path': {
      if (!Array.isArray(v.ops)) throw new Error('bad path');
      spend(v.ops.length);
      const ops: number[] = new Array(v.ops.length);
      for (let i = 0; i < v.ops.length; ) {
        const op = v.ops[i];
        if (!Number.isInteger(op) || op < 0 || op > 5) throw new Error('bad path op');
        const n = OP_ARGS[op as number];
        if (i + n >= v.ops.length) throw new Error('truncated path');
        ops[i] = op as number;
        for (let j = 1; j <= n; j++) ops[i + j] = coord(v.ops[i + j]);
        i += n + 1;
      }
      return { k: 'path', ops, m: mat(v.m), style: style(v.style) };
    }
    case 'point':
      spend(2);
      return { k: 'point', x: coord(v.x), y: coord(v.y), r: px(v.r, 4), style: style(v.style) };
    case 'arrow':
      spend(4);
      return {
        k: 'arrow',
        x1: coord(v.x1),
        y1: coord(v.y1),
        x2: coord(v.x2),
        y2: coord(v.y2),
        head: px(v.head, 10),
        style: style(v.style),
      };
    case 'text': {
      const t = text(v.text, L.maxText);
      spend(2 + t.length / 8);
      return {
        k: 'text',
        x: coord(v.x),
        y: coord(v.y),
        text: t,
        size: Math.max(4, px(v.size, 14)),
        align: pick(v.align, ['left', 'center', 'right'] as const, 'left'),
        baseline: pick(v.baseline, ['top', 'middle', 'bottom', 'alphabetic'] as const, 'alphabetic'),
        font: pick(v.font, ['sans', 'serif', 'mono'] as const, 'sans'),
        bold: v.bold === true,
        angle: fin(v.angle) ? v.angle : 0,
        halo: v.halo === true,
        style: style(v.style),
      };
    }
    case 'clip': {
      if (typeof v.id !== 'string' || !ASSET_ID.test(v.id)) throw new Error('bad clip id');
      if (!fin(v.frame)) throw new Error('bad clip frame');
      spend(16);
      return { k: 'clip', id: v.id, frame: Math.floor(v.frame), m: mat(v.m), style: style(v.style) };
    }
    default:
      throw new Error('unknown item kind');
  }
}

function slider(v: unknown): SliderDecl | null {
  if (!isObj(v) || typeof v.name !== 'string' || !/^[A-Za-z_$][\w$ ]*$/.test(v.name)) return null;
  if (v.name.length > L.maxName) return null;
  const min = fin(v.min) ? v.min : 0;
  const max = fin(v.max) ? v.max : 1;
  if (!(max > min) || Math.abs(min) > L.maxAbs || Math.abs(max) > L.maxAbs) return null;
  const value = fin(v.value) ? Math.min(max, Math.max(min, v.value)) : min;
  const step = fin(v.step) && v.step > 0 ? Math.min(v.step, max - min) : 0;
  return { name: v.name, min, max, value, step };
}

/**
 * Validate a frame from the runtime. Never throws: a malformed frame comes back
 * as an error (and nothing of it is drawn).
 */
export function sanitizeFrame(raw: unknown): { ok: true; frame: ScriptFrame } | { ok: false; error: string } {
  try {
    if (!isObj(raw)) throw new Error('not an object');
    if (!Array.isArray(raw.items)) throw new Error('no items');
    if (raw.items.length > L.maxItems) throw new Error(`too many shapes (${raw.items.length}; max ${L.maxItems})`);
    const budget = { n: L.maxNumbers };
    const items = raw.items.map((v) => item(v, budget));
    const sliders: SliderDecl[] = [];
    const seen = new Set<string>();
    if (Array.isArray(raw.sliders)) {
      for (const s of raw.sliders.slice(0, L.maxSliders)) {
        const d = slider(s);
        if (d && !seen.has(d.name)) {
          seen.add(d.name);
          sliders.push(d);
        }
      }
    }
    const logs = Array.isArray(raw.logs) ? raw.logs.slice(0, L.maxLogs).map((l) => text(l, L.maxLogLine)) : [];
    const loop = fin(raw.loop) && raw.loop > 0 && raw.loop <= 1e6 ? raw.loop : null;
    return {
      ok: true,
      frame: {
        items,
        background: safeColor(raw.background),
        sliders,
        logs,
        loop,
        ms: fin(raw.ms) ? Math.max(0, raw.ms) : 0,
        animated: raw.animated === true,
      },
    };
  } catch (err) {
    return { ok: false, error: `The script's output was rejected: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export function sanitizeError(raw: unknown): ScriptError {
  const e = isObj(raw) ? raw : {};
  const out: ScriptError = { message: text(e.message, L.maxLogLine) || 'Script error' };
  if (Number.isInteger(e.line) && (e.line as number) > 0 && (e.line as number) < 1e6) out.line = e.line as number;
  if (Number.isInteger(e.column) && (e.column as number) >= 0 && (e.column as number) < 1e6) out.column = e.column as number;
  return out;
}

/**
 * Validate any message claiming to come from the runtime. Returns null for
 * anything that isn't a well-formed runtime message.
 */
export function parseRuntimeMessage(raw: unknown): FromRuntime | { type: 'invalid'; id: number; error: string } | null {
  if (!isObj(raw) || typeof raw.type !== 'string') return null;
  if (raw.type === 'ready') return { type: 'ready' };
  const id = Number.isInteger(raw.id) ? (raw.id as number) : -1;
  if (id < 0) return null;
  if (raw.type === 'frame') {
    const f = sanitizeFrame(raw.frame);
    return f.ok ? { type: 'frame', id, frame: f.frame } : { type: 'invalid', id, error: f.error };
  }
  if (raw.type === 'error') {
    const out: FromRuntime = { type: 'error', id, error: sanitizeError(raw.error) };
    if (raw.frame !== undefined) {
      const f = sanitizeFrame(raw.frame);
      if (f.ok) out.frame = f.frame;
    }
    return out;
  }
  return null;
}

/** Does this source use the clock (and so animate)? */
export function usesClock(code: string): boolean {
  // Strip comments and strings so `// time` or "frame" don't count.
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/(['"])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');
  return /(?<![\w$.])(?:time|frame)(?![\w$])/.test(stripped);
}
