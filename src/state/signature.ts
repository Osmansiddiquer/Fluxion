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
      `${F}${e.varValue ?? ''}${F}${e.thetaMin ?? ''}${F}${e.thetaMax ?? ''}${F}${e.frames ?? ''}${R}`;
  }
  return s;
}
