import type { Entry } from '../store/types';

// Field / record separators: control characters can't appear in typed input, so
// adjacent fields can never run together into the same string.
const F = '\u0001';
const R = '\u0002';

/**
 * A string capturing only the fields of `entries` that actually affect the
 * computed curves/features. Styling-and-UX-only edits (colour, expanded, point
 * size, label, animation, variable-slider bounds, line/fill style, colour
 * expressions, autoplay) leave this unchanged, so the expensive recompute is
 * skipped entirely. Order is significant (ODE t0 ordering + intersection
 * pairing), so we keep the entries in array order.
 */
export function computeSignature(entries: Entry[]): string {
  let s = '';
  for (const e of entries) {
    s +=
      `${e.id}${F}${e.raw}${F}${e.visible ? 1 : 0}${F}${e.t0 ?? ''}${F}${e.ic?.join(',') ?? ''}` +
      `${F}${e.varValue ?? ''}${F}${e.thetaMin ?? ''}${F}${e.thetaMax ?? ''}${F}${e.frames ?? ''}` +
      // Animation options that change what is sampled (resolution; off-screen
      // culling depends on the layer and on glow / blur spread).
      `${F}${e.samples ?? ''}${F}${e.layer ?? ''}${F}${e.glow ?? ''}${F}${e.blur ?? ''}` +
      `${F}${odeViewSig(e)}${R}`;
  }
  return s;
}

/**
 * The ODE-view part of an entry's signature: slope field, phase plane, extra
 * solutions, and a parameter family (whose ghost values follow the slider's
 * range, so its bounds count only while the family is on). '' when none is set,
 * so graphs that don't use them keep their old signature.
 */
export function odeViewSig(e: Entry): string {
  let s = '';
  if (e.field !== undefined) s += `f${e.field ? 1 : 0}`;
  if (e.phase) s += `p${e.phaseAxes?.join(',') ?? ''}`;
  if (e.extraICs?.length) s += `x${e.extraICs.map((v) => v.join(',')).join(';')}`;
  if (e.family) s += `m${e.varMin ?? ''},${e.varMax ?? ''}`;
  return s;
}
