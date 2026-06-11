/** A single (t, y) sample. */
export type Point = [number, number];

/**
 * A curve ready to draw: one or more continuous polylines. Breaks between
 * segments mark discontinuities, asymptotes, or where integration stopped.
 */
export interface SampledCurve {
  segments: Point[][];
}

export const EMPTY_CURVE: SampledCurve = { segments: [] };
