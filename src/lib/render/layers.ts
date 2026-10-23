import type { Entry } from '../../store/types';
import type { CurveResult } from '../compute';
import type { Mat } from '../script/protocol';
import { compileNode } from '../math/compileCache';
import { KNOWN_FUNCTIONS } from '../math/builtins';
import { calledFunctions } from '../math/parse';
import { layerMatrix, mulMat } from './canvas';

/**
 * Layers: a row `fg = layer(dx, dy[, scale[, angle[, cx, cy]]])` defines a
 * transform evaluated every frame against the slider scope (so a parallax pan,
 * a shake or a zoom is one value). Entries whose `layer` option names it are
 * drawn moved by it, at the layer row's position in the list (its z-order).
 * A layer called `camera` moves everything drawn (after each entry's own layer).
 * Transforms are applied at draw time: moving a layer never re-samples curves.
 */
export const CAMERA = 'camera';

export interface LayerInfo {
  mat: Mat;
  /** Index of the layer's row in the entry list (z-position). */
  index: number;
  error?: string;
}

export function evalLayers(
  entries: Entry[],
  results: Map<string, CurveResult>,
  scope: Record<string, unknown>,
): Map<string, LayerInfo> {
  const out = new Map<string, LayerInfo>();
  entries.forEach((entry, index) => {
    const p = results.get(entry.id)?.parsed;
    if (p?.kind !== 'layer' || out.has(p.name)) return;
    if (!entry.visible) return; // a hidden layer row = identity (its members stay put)
    let error: string | undefined;
    const vals = p.args.map((a) => {
      // Untrusted input: only built-ins and the graph's own functions are called.
      if ([...calledFunctions(a)].some((f) => !KNOWN_FUNCTIONS.has(f) && typeof scope[f] !== 'function')) {
        error = 'Unknown function';
        return NaN;
      }
      try {
        const v = compileNode(a).evaluate(scope);
        return typeof v === 'number' ? v : NaN;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        return NaN;
      }
    });
    if (!vals.every(Number.isFinite)) {
      out.set(p.name, { mat: [1, 0, 0, 1, 0, 0], index, error: error ?? 'Layer values must be finite numbers' });
      return;
    }
    out.set(p.name, { mat: layerMatrix(vals[0], vals[1], vals[2] ?? 1, vals[3] ?? 0, vals[4] ?? 0, vals[5] ?? 0), index });
  });
  return out;
}

/**
 * Entries in drawing order with their data-space transform (null = none).
 * Unlayered entries keep their place; an entry on layer L moves to L's row,
 * keeping list order among L's members. Unknown layer names draw in place.
 */
export function drawOrder(entries: Entry[], layers: Map<string, LayerInfo>): { entry: Entry; mat: Mat | null }[] {
  const camera = layers.get(CAMERA)?.mat ?? null;
  const slots: { key: number; sub: number; entry: Entry; mat: Mat | null }[] = [];
  entries.forEach((entry, i) => {
    const L = entry.layer ? layers.get(entry.layer) : undefined;
    let mat: Mat | null = L ? L.mat : null;
    if (camera && entry.layer !== CAMERA) mat = mat ? mulMat(camera, mat) : camera;
    // Sort key: the layer row's index (members right after it), else own index.
    slots.push({ key: L ? L.index : i, sub: L ? 1 : 0, entry, mat });
  });
  // Stable: by key, then the layer row before its members, then list order.
  return slots
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => a.key - b.key || a.sub - b.sub || a.i - b.i)
    .map(({ entry, mat }) => ({ entry, mat }));
}
