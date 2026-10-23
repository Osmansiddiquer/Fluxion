import type { Entry, FeatureToggles, Projections, ScriptDoc, Viewport } from '../store/types';
import { assetsFor } from './frames/assets';

/** The portable part of a graph — what gets exported to a file or a share link.
 * UI-only preferences (theme, sidebar/panel sizes) are intentionally excluded. */
export interface GraphData {
  v: 1;
  entries: Entry[];
  viewport: Viewport;
  features: FeatureToggles;
  projections: Projections;
  sigFigs: number;
  /** Large payloads referenced by entries / the script (frame sequences), keyed by asset id. */
  assets?: Record<string, string>;
  /** Script mode program (JavaScript, run sandboxed). */
  script?: ScriptDoc;
}

export function makeGraph(s: {
  entries: Entry[];
  viewport: Viewport;
  features: FeatureToggles;
  projections: Projections;
  sigFigs: number;
  script?: ScriptDoc;
}): GraphData {
  const g: GraphData = {
    v: 1,
    entries: s.entries,
    viewport: s.viewport,
    features: s.features,
    projections: s.projections,
    sigFigs: s.sigFigs,
  };
  if (s.script && s.script.code.trim()) {
    const sc: ScriptDoc = { code: s.script.code };
    if (s.script.sliders && Object.keys(s.script.sliders).length) sc.sliders = { ...s.script.sliders };
    if (s.script.clips && Object.keys(s.script.clips).length) sc.clips = { ...s.script.clips };
    if (s.script.visible === false) sc.visible = false;
    g.script = sc;
  }
  // Carry referenced frame sequences along so an exported file is self-contained.
  const assets = assetsFor([...s.entries.map((e) => e?.frames), ...Object.values(g.script?.clips ?? {})]);
  if (Object.keys(assets).length) g.assets = assets;
  return g;
}

/** A loose shape-check so a bad file / link can't wedge the app. */
export function isGraph(x: unknown): x is GraphData {
  if (!x || typeof x !== 'object') return false;
  const g = x as Record<string, unknown>;
  return Array.isArray(g.entries) && !!g.viewport && typeof g.viewport === 'object';
}

// Unicode-safe base64 (entries can contain θ, ×, …) for share links.
function toB64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
function fromB64(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeGraph(g: GraphData): string {
  return toB64(JSON.stringify(g));
}

export function decodeGraph(s: string): GraphData | null {
  try {
    const obj = JSON.parse(fromB64(s));
    return isGraph(obj) ? obj : null;
  } catch {
    return null;
  }
}

export function parseGraphFile(text: string): GraphData | null {
  try {
    const obj = JSON.parse(text);
    return isGraph(obj) ? obj : null;
  } catch {
    return null;
  }
}
