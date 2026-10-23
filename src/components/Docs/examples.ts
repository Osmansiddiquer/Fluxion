// Example graphs shared by the getting-started tour (components/Tutorial.tsx) and
// the in-app documentation (components/Docs). One definition per example, so the
// tour and the docs can never disagree. Kept tiny and dependency-light: the tour
// lives in the main bundle and imports this file; the docs chunk imports it too.
import type { GraphData } from '../../lib/graphFile';
import type { Entry, FeatureToggles, Projections, Viewport } from '../../store/types';
import { PALETTE } from '../../utils/colors';

/** What `parseEntry(raw).kind` is for an example line. Documented, and checked by
 * the docs tests, so a parser change that reclassifies an example is caught. */
export type DocKind =
  | 'function'
  | 'ode'
  | 'condition'
  | 'variable'
  | 'implicit'
  | 'polar'
  | 'points'
  | 'pointvar'
  | 'inequality'
  | 'parametric'
  | 'fndef'
  | 'repeat'
  | 'layer'
  | 'frames';

/** Per-line options: anything the user could set on a row besides its text. */
export type LineOptions = Partial<Omit<Entry, 'id' | 'raw' | 'visible'>>;

export interface ExampleLine {
  raw: string;
  kind: DocKind;
  opts?: LineOptions;
  /** A derived value (`s = skeys(T, …)`): kind 'function', but tagged "derived". */
  derived?: boolean;
}

export interface DocExample {
  /** Stable id (unique across all docs examples). */
  id: string;
  title: string;
  /** One-sentence description shown under the snippet. */
  blurb?: string;
  /** Optional KaTeX rendering of the headline expression. */
  tex?: string;
  lines: ExampleLine[];
  viewport?: Viewport;
  projections?: Projections;
  features?: Partial<FeatureToggles>;
  /** Open a built-in demo (lib/demos) instead of building from `lines`. */
  demo?: string;
}

export const DOC_FEATURES: FeatureToggles = {
  extrema: true,
  xIntercepts: true,
  yIntercept: true,
  endpoints: false,
  discontinuities: true,
  intersections: true,
};
export const PANELS_OFF: Projections = { rightOpen: false, bottomOpen: false, sliceT: 0, sliceY: 1 };
export const DEFAULT_DOC_VIEWPORT: Viewport = { tMin: -8, tMax: 8, yMin: -5, yMax: 5 };

/** Shorthand for an example line. */
export const L = (raw: string, kind: DocKind, opts?: LineOptions): ExampleLine => ({ raw, kind, opts });

let seq = 0;

/** Build a loadable graph from an example (fresh ids every call). Demo-backed
 * examples are built by the caller (it owns the demo registry). */
export function exampleGraph(ex: DocExample, sigFigs = 3): GraphData {
  const stamp = `${Date.now().toString(36)}${(seq++).toString(36)}`;
  let colour = 0;
  const entries: Entry[] = ex.lines.map((l, i) => {
    const isVar = l.kind === 'variable' || l.kind === 'fndef';
    const color = l.opts?.color ?? (isVar ? PALETTE[5] : PALETTE[[0, 1, 2, 3, 4, 6, 7][colour++ % 7]]);
    return {
      id: `doc-${ex.id}-${i}-${stamp}`,
      raw: l.raw,
      color,
      visible: true,
      expanded: false,
      ...l.opts,
    };
  });
  return {
    v: 1,
    entries,
    viewport: ex.viewport ?? DEFAULT_DOC_VIEWPORT,
    features: { ...DOC_FEATURES, ...ex.features },
    projections: ex.projections ?? PANELS_OFF,
    sigFigs,
  };
}

// ── The tour's four starter examples (also shown in the docs) ───────────────

export const TOUR_HARMONIC: DocExample = {
  id: 'harmonic',
  title: 'Harmonic motion',
  blurb: "A 2nd-order ODE solved from its initial conditions — y(0)=0, y'(0)=1.",
  tex: "y'' = -y",
  lines: [L("y'' = -y", 'ode', { color: '#c74440', t0: 0, ic: [0, 1], expanded: true })],
  viewport: { tMin: -1, tMax: 13, yMin: -2, yMax: 2 },
  projections: { rightOpen: true, bottomOpen: true, sliceT: 2.5, sliceY: 1 },
};

export const TOUR_LOGISTIC: DocExample = {
  id: 'logistic',
  title: 'Logistic growth',
  blurb: 'A nonlinear ODE — population that levels off at its carrying capacity.',
  tex: "y\\,' = y\\,(1 - y/4)",
  lines: [L("y' = y*(1 - y/4)", 'ode', { color: '#388c46', t0: 0, ic: [0.4], expanded: true })],
  viewport: { tMin: -1, tMax: 11, yMin: -0.5, yMax: 5 },
};

export const TOUR_SPIRAL: DocExample = {
  id: 'spiral-region',
  title: 'Spiral region',
  blurb: 'A polar inequality swept over θ — the shaded area inside an Archimedean spiral.',
  tex: 'r < 2\\theta',
  lines: [L('r < 2theta', 'inequality', { color: '#6042a6', thetaMin: 0, thetaMax: 4 * Math.PI, expanded: true })],
  viewport: { tMin: -28, tMax: 28, yMin: -18, yMax: 18 },
};

export const TOUR_ROSE: DocExample = {
  id: 'rose',
  title: 'Rose curve',
  blurb: 'A polar curve r = f(θ). Try editing the 3 to change the number of petals.',
  tex: 'r = 3\\sin(3\\theta)',
  lines: [L('r = 3 sin(3theta)', 'polar', { color: '#c74440', expanded: true })],
  viewport: { tMin: -4.5, tMax: 4.5, yMin: -3, yMax: 3 },
};

/** In tour order. */
export const TOUR_EXAMPLES: DocExample[] = [TOUR_HARMONIC, TOUR_LOGISTIC, TOUR_SPIRAL, TOUR_ROSE];
