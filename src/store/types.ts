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

  /** Polar entry (`r = f(θ)`): the θ sweep range (defaults to 0 … 2π). Also the
   * t-range of a parametric curve `(x(t), y(t))`. */
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

  /** Drawing style — all optional; defaults depend on the entry kind (lib/style.ts). */
  /** Stroke width in px (0 hides the stroke, e.g. for fill-only shapes). */
  lineWidth?: number;
  lineStyle?: LineStyle;
  /** Fill closed shapes (parametric / polar / polygons / frames). Inequalities fill by default. */
  fill?: boolean;
  /** Fill opacity 0…1. */
  fillOpacity?: number;
  /** Dynamic colour expression (`hsv(360a, 1, 1)`, `rgba(…)`) overriding `color`. */
  colorExpr?: string;
  /** Fill colour (literal or expression); defaults to the stroke colour. */
  fillColor?: string;

  /** Variable slider: start playing when the graph loads (used by demos). */
  autoplay?: boolean;
  /** `frames(i)` entry: id of its imported frame sequence (lib/frames/assets.ts). */
  frames?: string;
}

export type LineStyle = 'solid' | 'dashed' | 'dotted';

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
  /** Grid lines + axes (default shown). Off gives a clean canvas for drawings. */
  grid?: boolean;
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

/** Which editor the sidebar shows: the expression list or the script editor. */
export type AppMode = 'graph' | 'script';

/**
 * A Script-mode program (JavaScript run in the sandbox) plus its state. Lives
 * beside the expression list; both draw on the same canvas.
 */
export interface ScriptDoc {
  code: string;
  /** Current values of the script's slider() controls, by name. */
  sliders?: Record<string, number>;
  /** Imported clips the script can play with clip(name): name → asset id. */
  clips?: Record<string, string>;
  /** Show the script's drawing (default true). */
  visible?: boolean;
}
