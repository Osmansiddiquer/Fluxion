// Core domain types shared across the app.

/** Kinds of things a student can type into an entry row. */
export type EntryKind = 'ode' | 'function' | 'variable' | 'empty' | 'error';

/** A rectangle in data space describing what the main plot currently shows. */
export interface Viewport {
  tMin: number;
  tMax: number;
  yMin: number;
  yMax: number;
}

/**
 * A single row in the sidebar. The `raw` text is the source of truth; everything
 * about how to plot it is derived by parsing (see lib/math/parse.ts). The fields
 * here are the *user-controllable* state that parsing cannot infer: colour,
 * visibility, and the initial-value / slider settings.
 */
export interface Entry {
  id: string;
  raw: string;
  color: string;
  visible: boolean;
  /** Whether the per-entry controls (IVP sliders / variable slider) are expanded. */
  expanded: boolean;

  /** ODE initial conditions: t0 and the state vector [value, 1st deriv, ...] at t0. */
  t0?: number;
  ic?: number[];

  /** Variable entry (e.g. `a = 2`): current value + slider bounds/step. */
  varValue?: number;
  varMin?: number;
  varMax?: number;
  varStep?: number;

  /** Polar entry (`r = f(θ)`): the θ sweep range (defaults to 0 … 2π). */
  thetaMin?: number;
  thetaMax?: number;

  /** Slider animation mode (play button): repeat, back-and-forth, or one pass. */
  animMode?: AnimMode;
  /** Animation speed multiplier (1 = a full sweep in ~4s). */
  animSpeed?: number;

  /** Points entry: an optional LaTeX label placed in one of 8 directions. */
  pointLabel?: string;
  pointLabelDir?: PointDir;
  /** Point marker radius in px. */
  pointSize?: number;
  /** Draggability: auto (variable coords), off, or forced x / y / both axes. */
  pointDrag?: 'auto' | 'off' | 'x' | 'y' | 'both';
}

export type PointDir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export type AnimMode = 'loop' | 'bounce' | 'once';

/** Which families of inspection markers are currently shown. */
export interface FeatureToggles {
  extrema: boolean;
  xIntercepts: boolean;
  yIntercept: boolean;
  endpoints: boolean;
  discontinuities: boolean;
  intersections: boolean;
}

export type ThemeMode = 'light' | 'dark' | 'system';

/** State for the linked cross-section projection panels. */
export interface Projections {
  rightOpen: boolean; // y-slice panel (reads y(t) at sliceT)
  bottomOpen: boolean; // t-slice panel (reads t where curve = sliceY)
  sliceT: number; // vertical cursor position (a t value)
  sliceY: number; // horizontal cursor position (a y value)
  /** Optional expressions driving the cuts parametrically (e.g. "k"); when set,
   * the numeric sliceT/sliceY are resolved from these against the variable scope. */
  sliceTExpr?: string;
  sliceYExpr?: string;
}
