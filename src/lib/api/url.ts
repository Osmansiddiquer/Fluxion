import { decodeGraph, isGraph, type GraphData } from '../graphFile';
import {
  COLOR_NAMES,
  LIMITS,
  graphToSpec,
  suggestKey,
  type ExpressionSpec,
  type FluxionSpec,
} from './spec';

/**
 * The URL API. A static site has no backend, so "calling the API" means building
 * a link; opening it renders the graph, and the link itself is what gets shared.
 *
 * Accepted forms (fragment `#…` preferred — it never reaches a server and `+`
 * stays a plus; `?…` query strings work too, with standard form decoding):
 *
 *   #expr=y=sin(x)&expr=k=2&xmin=-10&xmax=10      simple, hand-writable params
 *   #spec={"expressions":["y=sin(x)"]}             JSON spec (percent-encoded)
 *   #spec=eyJleHByZXNzaW9ucyI6WyJ5PXNpbih4KSJdfQ   JSON spec, base64url
 *   #z=…                                           JSON spec, deflate-raw + base64url
 *   #g=…                                           legacy app share link (GraphData)
 *
 * Pure and isomorphic (browser + Node ≥ 18): uses TextEncoder, btoa/atob and
 * (Compression|Decompression)Stream only.
 */

export const DEFAULT_BASE_URL = 'https://osmansiddiquer.github.io/Fluxion/';

/** Largest URL payload we'll even try to decode (characters). */
export const MAX_PAYLOAD_CHARS = 300_000;

export type LinkFormat = 'z' | 'json' | 'b64' | 'params';

export type UrlPayload =
  | { kind: 'none' }
  | { kind: 'spec'; spec: unknown; format: LinkFormat; warnings: string[] }
  | { kind: 'legacy'; graph: GraphData }
  | { kind: 'error'; message: string };

// ── base64url ────────────────────────────────────────────────────────────────

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes base64url *or* standard base64 (with or without padding). */
export function base64UrlToBytes(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error('not valid base64');
  const padded = clean.replace(/=+$/, '') + '==='.slice((clean.replace(/=+$/, '').length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const textToBase64Url = (s: string) => bytesToBase64Url(new TextEncoder().encode(s));
export const base64UrlToText = (s: string) =>
  new TextDecoder('utf-8', { fatal: true }).decode(base64UrlToBytes(s));

// ── deflate-raw ──────────────────────────────────────────────────────────────

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit: number) {
  const writer = stream.writable.getWriter();
  writer.write(new Uint8Array(bytes)).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    // Bail out of decompression bombs before they're fully inflated.
    if (total > limit) {
      reader.cancel().catch(() => {});
      throw new Error(`payload is too large (over ${limit} bytes)`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export async function deflateText(s: string): Promise<Uint8Array> {
  return pipe(new TextEncoder().encode(s), new CompressionStream('deflate-raw'), Infinity);
}

export async function inflateText(bytes: Uint8Array, limit: number = LIMITS.maxSpecBytes): Promise<string> {
  const out = await pipe(bytes, new DecompressionStream('deflate-raw'), limit);
  return new TextDecoder('utf-8', { fatal: true }).decode(out);
}

// ── percent-encoding ─────────────────────────────────────────────────────────

/** decodeURIComponent that never throws: malformed % escapes are kept verbatim. */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s.replace(/(?:%[0-9a-fA-F]{2})+/g, (m) => {
      try {
        return decodeURIComponent(m);
      } catch {
        return m;
      }
    });
  }
}

/**
 * Percent-encode a value for a URL fragment/query, but leave characters that are
 * legal there (and common in math) readable: = , / : ; @ $ ^ ( ) * !. Characters
 * that break auto-linking in chat/markdown — spaces, quotes, [ ] { } < > | — and
 * the separators & # % + are always encoded. (Parentheses stay: they're valid
 * URL characters and markdown/linkifiers accept them when balanced.)
 */
export function encodeValue(s: string): string {
  return encodeURIComponent(s)
    .replace(/%3D/g, '=')
    .replace(/%2C/g, ',')
    .replace(/%2F/g, '/')
    .replace(/%3A/g, ':')
    .replace(/%3B/g, ';')
    .replace(/%40/g, '@')
    .replace(/%24/g, '$')
    .replace(/%5E/g, '^')
    .replace(/'/g, '%27');
}

// ── simple params form ───────────────────────────────────────────────────────

/** Graph-level params. */
export const GLOBAL_PARAMS = ['xmin', 'xmax', 'ymin', 'ymax', 'sigfigs', 'panels', 'markers'] as const;
/** Per-expression params; each applies to the most recent `expr`. */
export const EXPR_PARAMS = [
  'color',
  'hidden',
  't0',
  'ic',
  'min',
  'max',
  'step',
  'anim',
  'speed',
  'thetamin',
  'thetamax',
  'label',
  'labeldir',
  'size',
  'drag',
] as const;
const PARAM_TO_KEY: Record<(typeof EXPR_PARAMS)[number], keyof ExpressionSpec> = {
  color: 'color',
  hidden: 'hidden',
  t0: 't0',
  ic: 'ic',
  min: 'min',
  max: 'max',
  step: 'step',
  anim: 'anim',
  speed: 'speed',
  thetamin: 'thetaMin',
  thetamax: 'thetaMax',
  label: 'label',
  labeldir: 'labelDir',
  size: 'pointSize',
  drag: 'drag',
};
const ALL_PARAMS: readonly string[] = ['expr', ...GLOBAL_PARAMS, ...EXPR_PARAMS];
/** Keys that make a query string / fragment an API payload. */
const PAYLOAD_KEYS = ['expr', 'spec', 'z', 'g'];

/**
 * Split `a=1&b=2` into pairs. An `&` only separates parameters when it's followed
 * by a known `key=`, so a compound inequality like `expr=y>0&y<x` survives even
 * if the agent forgot to encode its `&` as %26.
 */
export function splitParams(s: string, plusIsSpace: boolean): [string, string][] {
  const keys = [...ALL_PARAMS, ...PAYLOAD_KEYS];
  const body = s.replace(/^[#?]/, '');
  if (!body) return [];
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '&') continue;
    // after: '=' (key=…), '&' or '' (bare key / end); undefined if anything else follows.
    const m = body.slice(i + 1).match(/^([A-Za-z0-9_$]*)([=&]|$)/);
    const name = m ? m[1].toLowerCase() : '';
    const after = m ? m[2] : undefined;
    // Separate on an empty part, a known key (`k=`, `k&`, `k` at the end), or any
    // `key=` when the current part can't be an inequality that continues past `&`.
    const known = keys.includes(name) && after !== undefined;
    const anyKey = after === '=' && name !== '' && !/[<>]/.test(body.slice(start, i));
    const emptyPart = name === '' && (after === '&' || after === '');
    if (emptyPart || known || anyKey) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts
    .filter((p) => p.length)
    .map((p) => {
      const eq = p.indexOf('=');
      const rawK = eq < 0 ? p : p.slice(0, eq);
      const rawV = eq < 0 ? '' : p.slice(eq + 1);
      const dec = (x: string) => safeDecode(plusIsSpace ? x.replace(/\+/g, ' ') : x);
      return [dec(rawK).trim(), dec(rawV)];
    });
}

const bool = (v: string): boolean | string => {
  const s = v.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', ''].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return v; // left as a string so validateSpec reports it
};
const numish = (v: string): number | string => {
  const s = v.trim();
  return s !== '' && Number.isFinite(Number(s)) ? Number(s) : s;
};

/** Build a (not yet validated) FluxionSpec from simple `expr=…` params. */
export function paramsToSpec(pairs: [string, string][]): { spec: FluxionSpec; warnings: string[] } {
  const warnings: string[] = [];
  const expressions: ExpressionSpec[] = [];
  const spec: FluxionSpec = { expressions };
  const viewport: Record<string, number | string> = {};
  for (const [rawKey, value] of pairs) {
    const key = rawKey.toLowerCase();
    if (key === 'expr') {
      expressions.push({ expr: value });
      continue;
    }
    if ((VIEWPORT_PARAMS as readonly string[]).includes(key)) {
      viewport[key] = numish(value);
    } else if (key === 'sigfigs') {
      spec.sigFigs = numish(value) as number;
    } else if (key === 'panels') {
      const s = value.trim().toLowerCase();
      const right = s === 'right' || s === 'both' || s === 'all' || s === '1' || s === 'on';
      const bottom = s === 'bottom' || s === 'both' || s === 'all' || s === '1' || s === 'on';
      if (!['right', 'bottom', 'both', 'all', 'none', '0', '1', 'on', 'off'].includes(s)) {
        warnings.push(`panels=${value}: expected none, right, bottom or both`);
      }
      spec.panels = { right, bottom };
    } else if (key === 'markers') {
      const b = bool(value);
      if (typeof b === 'boolean' && !b) {
        spec.features = {
          extrema: false,
          xIntercepts: false,
          yIntercept: false,
          endpoints: false,
          discontinuities: false,
          intersections: false,
        };
      } else if (typeof b !== 'boolean') warnings.push(`markers=${value}: expected on or off`);
    } else if ((EXPR_PARAMS as readonly string[]).includes(key)) {
      const last = expressions[expressions.length - 1];
      if (!last) {
        warnings.push(`${rawKey}=${value} appears before any expr=… and was ignored`);
        continue;
      }
      const k = PARAM_TO_KEY[key as (typeof EXPR_PARAMS)[number]];
      const rec = last as unknown as Record<string, unknown>;
      if (k === 'hidden') rec[k] = bool(value);
      else if (k === 'ic') rec[k] = value.split(',').map(numish);
      else if (['t0', 'min', 'max', 'step', 'speed', 'thetaMin', 'thetaMax', 'pointSize'].includes(k)) {
        rec[k] = numish(value);
      } else if (k === 'color') {
        // `#` can't appear raw in a fragment; accept "c74440" and "%23c74440".
        const c = value.trim();
        rec[k] = /^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(c) && !COLOR_NAMES[c.toLowerCase()] ? `#${c}` : c;
      } else rec[k] = value;
    } else {
      const s = suggestKey(rawKey, ALL_PARAMS);
      warnings.push(`unknown parameter "${rawKey}"` + (s ? ` — did you mean "${s}"?` : '') + '; ignored');
    }
  }
  if (Object.keys(viewport).length) spec.viewport = viewport;
  return { spec, warnings };
}
const VIEWPORT_PARAMS = ['xmin', 'xmax', 'ymin', 'ymax'] as const;

/** Inverse of paramsToSpec for specs it can represent (no colours by name etc. lost). */
export function specToParams(spec: FluxionSpec): string | null {
  const parts: string[] = [];
  const push = (k: string, v: string | number | boolean) => parts.push(`${k}=${encodeValue(String(v))}`);
  for (const item of spec.expressions) {
    const e: ExpressionSpec = typeof item === 'string' ? { expr: item } : item;
    push('expr', e.expr);
    for (const p of EXPR_PARAMS) {
      const v = (e as unknown as Record<string, unknown>)[PARAM_TO_KEY[p]];
      if (v === undefined) continue;
      if (p === 'ic') push(p, (Array.isArray(v) ? v : [v]).join(','));
      else if (p === 'hidden') push(p, v ? 1 : 0);
      else if (p === 'color') push(p, String(v).replace(/^#/, ''));
      else push(p, v as string | number);
    }
  }
  if (spec.viewport) for (const k of VIEWPORT_PARAMS) if (spec.viewport[k] !== undefined) push(k, spec.viewport[k]!);
  if (spec.sigFigs !== undefined) push('sigfigs', spec.sigFigs);
  if (spec.panels) {
    const { right, bottom, ...rest } = spec.panels;
    if (Object.keys(rest).length) return null;
    const r = right ?? true;
    const b = bottom ?? true;
    push('panels', r && b ? 'both' : r ? 'right' : b ? 'bottom' : 'none');
  }
  if (spec.features) {
    const allOff = Object.keys(spec.features).length === 6 && Object.values(spec.features).every((v) => v === false);
    if (!allOff) return null;
    push('markers', 'off');
  }
  return parts.join('&');
}

// ── decode ───────────────────────────────────────────────────────────────────

/** Decode a `spec=` value: percent-encoded JSON, or base64(url) JSON. */
export function decodeSpecValue(value: string): unknown {
  const text = safeDecode(value).trim();
  if (text.startsWith('{') || text.startsWith('[')) return JSON.parse(text);
  return JSON.parse(base64UrlToText(text));
}

function firstValue(pairs: [string, string][], key: string): string | undefined {
  return pairs.find(([k]) => k.toLowerCase() === key)?.[1];
}

/**
 * Read an API payload from a URL's fragment and query string (fragment wins).
 * Never throws: decode problems come back as `{ kind: 'error' }`.
 */
export async function readUrlPayload(hash: string, search: string): Promise<UrlPayload> {
  for (const [part, isQuery] of [
    [hash, false],
    [search, true],
  ] as const) {
    if (!part || part.length <= 1) continue;
    if (part.length > MAX_PAYLOAD_CHARS) {
      return { kind: 'error', message: 'This link is too long to load.' };
    }
    // Legacy share links: `#g=<base64 GraphData>` — keep these working exactly.
    const legacy = part.match(/^#g=(.+)$/);
    if (legacy) {
      const g = decodeGraph(safeDecode(legacy[1]));
      return g ? { kind: 'legacy', graph: g } : { kind: 'error', message: 'This share link is damaged or incomplete.' };
    }
    const pairs = splitParams(part, isQuery);
    const keys = pairs.map(([k]) => k.toLowerCase());
    if (!keys.some((k) => PAYLOAD_KEYS.includes(k))) continue;
    try {
      const z = firstValue(pairs, 'z');
      if (z !== undefined) {
        const json = await inflateText(base64UrlToBytes(safeDecode(z)));
        return { kind: 'spec', spec: JSON.parse(json), format: 'z', warnings: [] };
      }
      const s = firstValue(pairs, 'spec');
      if (s !== undefined) {
        const text = safeDecode(s).trim();
        const format: LinkFormat = text.startsWith('{') || text.startsWith('[') ? 'json' : 'b64';
        if (text.length > LIMITS.maxSpecBytes) throw new Error('payload is too large');
        return { kind: 'spec', spec: decodeSpecValue(s), format, warnings: [] };
      }
      const g = firstValue(pairs, 'g');
      if (g !== undefined) {
        const graph = decodeGraph(safeDecode(g));
        if (graph) return { kind: 'legacy', graph };
        throw new Error('damaged share link');
      }
      const { spec, warnings } = paramsToSpec(pairs);
      return { kind: 'spec', spec, format: 'params', warnings };
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      return { kind: 'error', message: `Could not read the graph in this link (${why}).` };
    }
  }
  return { kind: 'none' };
}

/** Cheap synchronous test: does this location carry a graph? (e.g. to skip the tour) */
export function hasUrlPayload(hash: string, search: string): boolean {
  const re = /(?:^[#?]|&)(?:expr|spec|z|g)=/i;
  return re.test(hash) || re.test(search);
}

/** Remove API params from a query string, keeping unrelated ones (utm_…, etc.). */
export function stripApiParams(search: string): string {
  if (!search || search.length <= 1) return '';
  if (!hasUrlPayload('', search)) return search;
  const api = new Set([...ALL_PARAMS, ...PAYLOAD_KEYS]);
  const kept = search
    .slice(1)
    .split('&')
    .filter((p) => p && !api.has(safeDecode(p.split('=')[0]).toLowerCase()) && !/^[^=]*[<>]/.test(p));
  return kept.length ? `?${kept.join('&')}` : '';
}

// ── encode ───────────────────────────────────────────────────────────────────

export interface LinkOptions {
  base?: string;
  /** 'z' (compressed, shortest — default), 'json' (readable), 'b64', 'params'. */
  format?: LinkFormat;
}

function withBase(base: string, fragment: string): string {
  return `${base.replace(/#.*$/, '')}#${fragment}`;
}

/** Build a shareable link for a spec. 'params' falls back to 'json' if the spec
 * uses options the simple form can't express. */
export async function buildLink(spec: FluxionSpec, opts: LinkOptions = {}): Promise<string> {
  const base = opts.base ?? DEFAULT_BASE_URL;
  const format = opts.format ?? 'z';
  if (format === 'params') {
    const p = specToParams(spec);
    if (p !== null) return withBase(base, p);
  }
  const json = JSON.stringify(spec);
  if (format === 'z') return withBase(base, `z=${bytesToBase64Url(await deflateText(json))}`);
  if (format === 'b64') return withBase(base, `spec=${textToBase64Url(json)}`);
  return withBase(base, `spec=${encodeValue(json)}`);
}

/** Decode any Fluxion link (or bare fragment) back into a spec, for editing. */
export async function linkToSpec(link: string): Promise<{ spec?: unknown; error?: string; warnings: string[] }> {
  let hash = '';
  let search = '';
  const s = link.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      hash = u.hash;
      search = u.search;
    } catch {
      return { error: 'That is not a valid URL.', warnings: [] };
    }
  } else if (s.startsWith('?')) search = s;
  else hash = s.startsWith('#') ? s : `#${s}`;
  const p = await readUrlPayload(hash, search);
  if (p.kind === 'spec') return { spec: p.spec, warnings: p.warnings };
  if (p.kind === 'legacy') return { spec: graphToSpec(p.graph), warnings: [] };
  if (p.kind === 'error') return { error: p.message, warnings: [] };
  return { error: 'No Fluxion graph found in this link.', warnings: [] };
}

export { isGraph };
