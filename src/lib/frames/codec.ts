/**
 * Frame-sequence codec. A clip is a list of frames; each frame is a set of closed
 * integer polygons (contours of a binary image, see trace.ts) drawn with the
 * even-odd rule, so holes need no special casing.
 *
 * Text format (compact, JSON/URL safe):
 *
 *   FXF1;w=<W>;h=<H>;fps=<F>;box=<x0>,<y0>,<x1>,<y1>
 *   <frame 0>
 *   <frame 1>
 *   …
 *
 * W×H is the integer coordinate extent (image y points down); box is the
 * data-space rectangle the clip maps to. Each frame line is base64url of an
 * unsigned-LEB128 varint stream: polygonCount, then per polygon: pointCount,
 * x0, y0, then (pointCount−1) zigzag-encoded (dx, dy) deltas.
 */

export type IPoly = [number, number][];

export interface ClipHeader {
  w: number;
  h: number;
  fps: number;
  box: [number, number, number, number];
}

export interface Clip extends ClipHeader {
  frames: IPoly[][];
}

const MAGIC = 'FXF1';

// --- varints ---------------------------------------------------------------

function pushVarint(out: number[], n: number): void {
  let v = Math.floor(n);
  if (v < 0) throw new Error('varint must be non-negative');
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

const zig = (n: number) => (n >= 0 ? n * 2 : -n * 2 - 1);
const unzig = (n: number) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

class Reader {
  i = 0;
  constructor(private bytes: Uint8Array) {}
  get done() {
    return this.i >= this.bytes.length;
  }
  varint(): number {
    let result = 0;
    let mul = 1;
    for (;;) {
      if (this.i >= this.bytes.length) throw new Error('Truncated frame data');
      const b = this.bytes[this.i++];
      result += (b & 0x7f) * mul;
      if (b < 0x80) return result;
      mul *= 128;
      if (mul > 2 ** 49) throw new Error('Corrupt frame data');
    }
  }
}

// --- base64url ---------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INV = new Int16Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_INV[B64.charCodeAt(i)] = i;

export function toBase64Url(bytes: ArrayLike<number>): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) s += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) s += B64[n & 63];
  }
  return s;
}

export function fromBase64Url(s: string): Uint8Array {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const v = code < 128 ? B64_INV[code] : -1;
    if (v < 0) throw new Error('Invalid frame data');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

// --- frames ------------------------------------------------------------------

export function encodeFrame(polys: IPoly[]): string {
  const out: number[] = [];
  const kept = polys.filter((p) => p.length >= 2);
  pushVarint(out, kept.length);
  for (const poly of kept) {
    pushVarint(out, poly.length);
    pushVarint(out, poly[0][0]);
    pushVarint(out, poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      pushVarint(out, zig(poly[i][0] - poly[i - 1][0]));
      pushVarint(out, zig(poly[i][1] - poly[i - 1][1]));
    }
  }
  return toBase64Url(out);
}

export function decodeFrame(line: string): IPoly[] {
  if (!line) return [];
  const r = new Reader(fromBase64Url(line));
  const count = r.varint();
  const polys: IPoly[] = [];
  for (let p = 0; p < count; p++) {
    const n = r.varint();
    if (n > 1e6) throw new Error('Corrupt frame data');
    let x = r.varint();
    let y = r.varint();
    const poly: IPoly = [[x, y]];
    for (let i = 1; i < n; i++) {
      x += unzig(r.varint());
      y += unzig(r.varint());
      poly.push([x, y]);
    }
    polys.push(poly);
  }
  return polys;
}

export function encodeClip(clip: Clip): string {
  const head =
    `${MAGIC};w=${clip.w};h=${clip.h};fps=${clip.fps};box=` + clip.box.map((n) => +n.toFixed(6)).join(',');
  return [head, ...clip.frames.map(encodeFrame)].join('\n');
}

/** Parse just the header (cheap). Throws on a malformed clip. */
export function parseHeader(data: string): ClipHeader {
  const nl = data.indexOf('\n');
  const head = nl < 0 ? data : data.slice(0, nl);
  const parts = head.split(';');
  if (parts[0] !== MAGIC) throw new Error('Not a Fluxion frame sequence');
  const kv: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) kv[p.slice(0, eq)] = p.slice(eq + 1);
  }
  const w = Number(kv.w);
  const h = Number(kv.h);
  const fps = Number(kv.fps ?? 30);
  const box = (kv.box ?? '').split(',').map(Number);
  if (!(w > 0) || !(h > 0) || box.length !== 4 || box.some((n) => !Number.isFinite(n))) {
    throw new Error('Bad frame sequence header');
  }
  return { w, h, fps: fps > 0 ? fps : 30, box: box as ClipHeader['box'] };
}

/**
 * A decoded-on-demand clip: the header is parsed eagerly, frames lazily (with a
 * small cache), so a long sequence costs nothing until a frame is shown.
 */
export class FrameSequence {
  readonly header: ClipHeader;
  private lines: string[];
  private cache = new Map<number, IPoly[]>();

  constructor(data: string) {
    this.header = parseHeader(data);
    this.lines = data.split('\n').slice(1);
  }

  get count(): number {
    return this.lines.length;
  }

  /** Integer-coordinate polygons of frame `i` (wrapped into range). */
  frame(i: number): IPoly[] {
    const n = this.count;
    if (n === 0 || !Number.isFinite(i)) return [];
    const idx = ((Math.floor(i) % n) + n) % n;
    let polys = this.cache.get(idx);
    if (!polys) {
      polys = decodeFrame(this.lines[idx]);
      if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value as number);
      this.cache.set(idx, polys);
    }
    return polys;
  }

  /** Frame `i` mapped into data coordinates (image y down → data y up), each
   * polygon explicitly closed (last point = first) so strokes close too. */
  frameInData(i: number): [number, number][][] {
    const { w, h, box } = this.header;
    const [x0, y0, x1, y1] = box;
    const sx = (x1 - x0) / w;
    const sy = (y1 - y0) / h;
    return this.frame(i).map((poly) => {
      const pts = poly.map(([x, y]) => [x0 + x * sx, y1 - y * sy] as [number, number]);
      if (pts.length) pts.push([pts[0][0], pts[0][1]]);
      return pts;
    });
  }
}
