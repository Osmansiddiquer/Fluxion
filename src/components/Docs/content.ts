// The documentation, as data. This file is the single source of truth for what
// the docs page shows (src/docs-page renders it to static HTML at build time) and
// what the docs tests
// check (docs.test.ts): every example and syntax row must parse as its documented
// kind and compute without errors, and together they must cover every parse kind
// and every scripting helper. To add a section, append to SECTIONS (the order is
// the learning order); see CLAUDE.md "Docs".
//
// Inline markup in `text` strings: `code`, **bold**, $TeX$ (KaTeX), and
// [label](href) — an href of `#<id>` links to another section; other hrefs are
// relative to the docs page (/docs/), so the app is `../`.
import { L, TOUR_HARMONIC, TOUR_LOGISTIC, TOUR_ROSE, TOUR_SPIRAL, type DocExample, type DocKind, type ExampleLine, type LineOptions } from './examples';
import type { Viewport } from '../../store/types';

export interface SyntaxRow {
  /** What you type (plain text, exactly as it would go in a row). */
  input: string;
  kind: DocKind;
  note: string;
  /** A derived value (`b = 2a + 1`): parses as a function but draws nothing. */
  derived?: boolean;
  /** Rows the input needs to compute (e.g. the slider it uses). Loaded by "Try it". */
  with?: ExampleLine[];
  opts?: LineOptions;
  viewport?: Viewport;
}

export type Block =
  | { type: 'p'; text: string }
  | { type: 'h'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'steps'; items: string[] }
  | { type: 'syntax'; rows: SyntaxRow[] }
  | { type: 'table'; head: string[]; rows: string[][] }
  | { type: 'example'; example: DocExample }
  | { type: 'math'; tex: string }
  | { type: 'tip'; text: string }
  /** "Open the app / take the tour" call-to-action (docs home). */
  | { type: 'tour' }
  /** The Script mode reference slot (see docs-page/DocsPage.tsx SCRIPT_DOCS). */
  | { type: 'script-docs' };

export interface DocSection {
  id: string;
  title: string;
  /** One line under the title, also shown in search results and the home page. */
  summary: string;
  blocks: Block[];
}

const P = (text: string): Block => ({ type: 'p', text });
const H = (text: string): Block => ({ type: 'h', text });
const LIST = (...items: string[]): Block => ({ type: 'list', items });
const STEPS = (...items: string[]): Block => ({ type: 'steps', items });
const TIP = (text: string): Block => ({ type: 'tip', text });
const MATH = (tex: string): Block => ({ type: 'math', tex });
const SYNTAX = (...rows: SyntaxRow[]): Block => ({ type: 'syntax', rows });
const TABLE = (head: string[], ...rows: string[][]): Block => ({ type: 'table', head, rows });
const EX = (example: DocExample): Block => ({ type: 'example', example });
const row = (input: string, kind: DocKind, note: string, extra: Omit<SyntaxRow, 'input' | 'kind' | 'note'> = {}): SyntaxRow => ({
  input,
  kind,
  note,
  ...extra,
});

const WIDE: Viewport = { tMin: -10, tMax: 10, yMin: -6, yMax: 6 };
const CLEAN = { extrema: false, xIntercepts: false, yIntercept: false, discontinuities: false, intersections: false, grid: false };

// ── 1. Getting started ──────────────────────────────────────────────────────

const gettingStarted: DocSection = {
  id: 'getting-started',
  title: 'Getting started',
  summary: 'What Fluxion is, the screen layout, and your first graph.',
  blocks: [
    P(
      'Fluxion is a graphing calculator built for **differential equations**. Type an equation in the expression list and it is solved numerically and drawn as you type — alongside ordinary functions, curves, regions and points.',
    ),
    { type: 'tour' },
    H('The screen'),
    LIST(
      '**Expression list** (left; the ☰ button on phones): one expression per row. Click **+ Add expression** for a new row.',
      '**Graph** (centre): scroll to zoom around the cursor, drag empty space to pan, and press ⤢ in the top bar to reset the view.',
      '**Cross-section panels** (right and bottom): read every curve along a vertical or horizontal cut. See [Inspecting graphs](#inspect).',
      '**Top bar**: this help, bug reports, the share menu (save, export, Examples), significant figures, theme and reset view.',
    ),
    H('Your first graph'),
    STEPS(
      'Click a row and type `y = sin(x)`. The curve appears immediately.',
      'Add a row and type `y\' = -y`. Fluxion recognises an ODE, labels it **ODE**, and solves it from $y(0) = 1$.',
      'Click ▸ on the ODE row to show its initial-condition sliders and drag them.',
      'Add `a = 2` and change the first row to `y = a sin(x)`: `a` is now a slider.',
    ),
    EX({
      id: 'first-graph',
      title: 'First graph',
      blurb: 'A function, an ODE and a slider that drives the function.',
      lines: [
        L('a = 2', 'variable', { varMin: 0, varMax: 4, expanded: true }),
        L('y = a sin(x)', 'function'),
        L("y' = -y", 'ode', { ic: [1], expanded: true }),
      ],
      viewport: { tMin: -2, tMax: 10, yMin: -3, yMax: 3 },
    }),
    H('What can a row be?'),
    P('Fluxion decides what each row is from its shape. The small badge at the end of a row shows what it understood.'),
    SYNTAX(
      row('y = x^2 - 1', 'function', 'A function of x (or t). A bare expression means y = …'),
      row("y'' = -y", 'ode', 'A differential equation, solved numerically'),
      row('a = 2', 'variable', 'A slider other rows can use'),
      row('x^2 + y^2 = 9', 'implicit', 'Any other equation in x and y'),
      row('r = 2 + 2cos(theta)', 'polar', 'A polar curve'),
      row('(cos(3t), sin(2t))', 'parametric', 'A parametric curve'),
      row('y < sin(x)', 'inequality', 'A shaded region'),
      row('(1, 2)', 'points', 'A point, a list of points or a line'),
    ),
    TIP(
      'Fluxion reads plain text. Write `sin(x)` with parentheses, `2pi` or `pi*x` (not `πx`), and `abs(x)` (not `|x|`). If a row shows a red **!**, hover it to see why.',
    ),
  ],
};

// ── 2. Functions & curves ───────────────────────────────────────────────────

const curves: DocSection = {
  id: 'curves',
  title: 'Functions & curves',
  summary: 'Functions, implicit and polar curves, parametric curves, inequalities, points and segments.',
  blocks: [
    H('Functions'),
    P(
      'Write `y = …` or just the right-hand side. The variable can be `x` or `t`; they mean the same thing (the horizontal axis). Implicit multiplication works: `2x`, `3sin(x)`, `pi x`.',
    ),
    SYNTAX(
      row('y = sin(x)', 'function', 'Trig: sin cos tan sec csc cot, and asin / arcsin …'),
      row('x^2 - 1', 'function', 'A bare expression is y = …'),
      row('y = 3sin(2x) + e^(-x/4)', 'function', 'Powers with ^; e, pi, tau, phi are constants'),
      row('y = sqrt(abs(x))', 'function', 'sqrt cbrt exp ln log abs sign floor ceil round …'),
      row('y = 1/(x - 1)', 'function', 'Asymptotes are broken cleanly, not joined'),
      row('y = sin(x)/x', 'function', 'A removable hole is marked with a hollow dot'),
      row('y = sin(t) + t/4', 'function', 't works exactly like x'),
    ),
    TABLE(
      ['Group', 'Functions'],
      ['Trig', '`sin` `cos` `tan` `sec` `csc` `cot`; inverses `asin` or `arcsin` (also `sin^-1(x)`), …'],
      ['Hyperbolic', '`sinh` `cosh` `tanh` and their inverses'],
      ['Roots, logs', '`sqrt` `cbrt` `nthRoot(x, n)` `exp` `ln` `log` `log10` `log2`; `log` is natural, `log(x, b)` takes a base'],
      ['Rounding', '`abs` `sign` `floor` `ceil` `round` `mod(x, m)`'],
      ['Other', '`min` `max` `hypot` `atan2` `gamma` `factorial` (also `x!`)'],
      ['Constants', '`pi` (or π), `e`, `tau`, `phi`'],
    ),
    H('Implicit curves'),
    P('Any other equation in x and y is drawn as the set of points where it holds.'),
    SYNTAX(
      row('x^2 + y^2 = 9', 'implicit', 'Circle of radius 3'),
      row('x^2/9 + y^2/4 = 1', 'implicit', 'Ellipse'),
      row('x = 2', 'implicit', 'Vertical line'),
      row('x = y^2 - 3', 'implicit', 'A sideways parabola'),
      row('y^2 = x^3 - x', 'implicit', 'Elliptic curve'),
    ),
    H('Polar curves'),
    P(
      'Write $r = f(\\theta)$; type `theta` or `θ`. θ runs from 0 to 2π by default; expand the row (▸) to change the range, e.g. for spirals.',
    ),
    SYNTAX(
      row('r = 2 + 2cos(theta)', 'polar', 'Cardioid'),
      row('r = 3 sin(3theta)', 'polar', 'Rose with 3 petals'),
      row('r = theta/2', 'polar', 'Archimedean spiral (widen θ for more turns)', { opts: { thetaMin: 0, thetaMax: 6 * Math.PI } }),
    ),
    EX(TOUR_ROSE),
    H('Parametric curves'),
    P(
      '$(x(t),\\ y(t))$ traces a curve as t sweeps from 0 to 2π (change the range by expanding the row). Closed parametric curves can be filled — see [Drawing & styling](#drawing).',
    ),
    SYNTAX(
      row('(3cos(t), 2sin(t))', 'parametric', 'Ellipse'),
      row('(cos(3t), sin(2t))', 'parametric', 'Lissajous figure'),
      row('(t cos(t)/4, t sin(t)/4)', 'parametric', 'Spiral over several turns', { opts: { thetaMin: 0, thetaMax: 8 * Math.PI } }),
    ),
    H('Inequalities (shaded regions)'),
    P(
      'Use `<`, `>`, `<=`, `>=` (or `≤ ≥`). Chains like `1 < y < 2` work, `&` joins conditions, and polar regions use `r` and `theta`.',
    ),
    SYNTAX(
      row('y < sin(x)', 'inequality', 'Everything below the curve'),
      row('-1 < x < 1', 'inequality', 'A vertical band'),
      row('x^2 + y^2 <= 9 & y > 0', 'inequality', 'Upper half-disc (both conditions)'),
      row('r < 1 + cos(theta)', 'inequality', 'Inside a cardioid'),
    ),
    EX(TOUR_SPIRAL),
    P(
      'A polar region is swept over its whole θ range, so `r < 2θ` over two turns fills the area inside the spiral rather than one wedge. Boundaries are dotted for `<` and `>` (the edge is excluded) and solid for `<=` and `>=`.',
    ),
    H('Points and segments'),
    SYNTAX(
      row('(1, 2)', 'points', 'One point'),
      row('[(0, 0), (1, 1), (2, 4)]', 'points', 'Several separate points'),
      row('((0, 0), (2, 1), (4, 0))', 'points', 'A connected polyline (fill it to make a polygon)'),
      row('A = (a, 1)', 'pointvar', 'A named point — draggable when its coordinates are sliders', {
        with: [L('a = 2', 'variable')],
      }),
      row('(A, B)', 'points', 'The segment between two named points', {
        with: [L('A = (-2, -1)', 'pointvar'), L('B = (3, 2)', 'pointvar')],
      }),
    ),
    P(
      'Right-click a point row’s colour dot to set its **label** (LaTeX), label direction, marker size and **drag** mode: auto (drag along whichever coordinates are sliders), off, horizontal only, vertical only, or both.',
    ),
    EX({
      id: 'drag-point',
      title: 'A draggable point',
      blurb: 'Drag P on the graph: it moves the a and b sliders, and the circle follows.',
      lines: [
        L('a = 2', 'variable', { varMin: -5, varMax: 5 }),
        L('b = 1', 'variable', { varMin: -4, varMax: 4 }),
        L('P = (a, b)', 'pointvar', { pointLabel: 'P', pointLabelDir: 'ne', pointSize: 7 }),
        L('(x - a)^2 + (y - b)^2 = 1', 'implicit'),
        L('O = (0, 0)', 'pointvar', { pointLabel: 'O', pointLabelDir: 'sw' }),
        L('(O, P)', 'points', { lineStyle: 'dashed' }),
      ],
      viewport: { tMin: -6, tMax: 6, yMin: -4, yMax: 4 },
    }),
  ],
};

// ── 3. Differential equations ───────────────────────────────────────────────

const odes: DocSection = {
  id: 'odes',
  title: 'Differential equations',
  summary: 'First and higher order ODEs, systems, initial conditions, t₀, notation and blow-up.',
  blocks: [
    P(
      'Type an ODE and Fluxion solves it numerically (fourth-order Runge–Kutta), forwards and backwards from $t_0$ across the whole visible range. The solution is redrawn as you pan, zoom or change a slider.',
    ),
    H('First order'),
    SYNTAX(
      row("y' = -y", 'ode', 'Exponential decay'),
      row('dy/dt = t - y', 'ode', 'Leibniz notation works too'),
      row("y' = y*(1 - y/4)", 'ode', 'Logistic growth'),
      row("P' = r0*P*(1 - P/K)", 'ode', 'Any name can be the unknown; parameters are sliders', {
        with: [L('r0 = 0.8', 'variable', { varMin: 0, varMax: 3 }), L('K = 4', 'variable', { varMin: 1, varMax: 8 })],
        opts: { ic: [0.5] },
      }),
    ),
    EX(TOUR_LOGISTIC),
    H('Higher order'),
    P('Any equation that can be solved for its highest derivative works:'),
    MATH("y^{(n)} = f\\big(t,\\ y,\\ y',\\ \\ldots,\\ y^{(n-1)}\\big)"),
    P(
      'Orders 1 to 10. Write derivatives with primes (`y\'\'`) or as `d^2y/dt^2`. The equation can be in any form that is linear in the highest derivative, so `y\'\' + 0.4y\' + 4y = 0` is fine.',
    ),
    SYNTAX(
      row("y'' = -y", 'ode', 'Simple harmonic motion'),
      row("y'' + 0.4y' + 4y = 0", 'ode', 'Damped oscillator'),
      row('d^2u/dt^2 = -sin(u)', 'ode', 'Nonlinear pendulum', { opts: { ic: [2, 0] } }),
      row("y''' = -y'", 'ode', 'Third order'),
    ),
    EX(TOUR_HARMONIC),
    H('Initial conditions and t₀'),
    P(
      'An n-th order ODE needs n initial values at the start time $t_0$: $y(t_0), y\'(t_0), \\ldots$. Expand the row (▸) to see a slider for $t_0$ and one for each value. If you never set them, Fluxion uses $y(t_0) = 1$, zero for every derivative, and $t_0 = 0$.',
    ),
    LIST(
      'Drag a slider to move the solution; each slider has its own ▶ play button, so you can animate an initial condition.',
      'Type an exact value into the number box at either end of a slider.',
      'Move $t_0$ to start the solution somewhere else; it is integrated both ways from there.',
    ),
    EX({
      id: 'pendulum-family',
      title: 'Pendulum from different starts',
      blurb: 'The same equation twice, released from different angles. Expand a row to drag its initial angle.',
      lines: [
        L("u'' = -sin(u)", 'ode', { ic: [1, 0], expanded: true }),
        L("u'' = -sin(u)", 'ode', { ic: [3, 0], expanded: true }),
      ],
      viewport: { tMin: -1, tMax: 20, yMin: -4, yMax: 4 },
    }),
    H('Systems'),
    P(
      'Write one equation per row. Fluxion detects which equations refer to each other and solves the coupled system together; each unknown is drawn against t. The system shares the $t_0$ of its first equation.',
    ),
    SYNTAX(
      row("x' = y", 'ode', 'Rows 1–2 form a system: a damped oscillator', {
        with: [L("y' = -x - 0.2y", 'ode')],
      }),
      row("x' = 10*(y - x)", 'ode', 'With the next two rows: the Lorenz system', {
        with: [L("y' = x*(28 - z) - y", 'ode', { ic: [1] }), L("z' = x*y - 8/3*z", 'ode', { ic: [1] })],
        viewport: { tMin: 0, tMax: 30, yMin: -30, yMax: 50 },
      }),
    ),
    EX({
      id: 'predator-prey',
      title: 'Predator and prey',
      blurb: 'Lotka–Volterra: rabbits R and foxes F, coupled through the two equations.',
      lines: [
        L("R' = R*(1 - F/2)", 'ode', { ic: [3], expanded: true }),
        L("F' = F*(R/3 - 1)", 'ode', { ic: [1], expanded: true }),
      ],
      viewport: { tMin: -1, tMax: 20, yMin: -1, yMax: 7 },
    }),
    H('x or t?'),
    LIST(
      'In a function, `x` and `t` are interchangeable: `y = sin(x)` and `y = sin(t)` are the same curve.',
      'If a function uses both, `t` is the horizontal axis and `x` is treated as a name you need to define (a slider).',
      '**ODEs always use t** as the independent variable. Write `y\' = t*y`, not `y\' = x*y`. In a system, `x` can be one of the unknowns (`x\' = y`).',
    ),
    H('When solutions blow up'),
    P(
      'Some solutions run off to infinity in finite time. $y\' = y^2$ from $y(0) = 1$ is $y = 1/(1 - t)$, which explodes at $t = 1$. Fluxion stops the curve once it leaves a huge range (|y| > 10⁶) or stops being a number, rather than drawing a misleading line. Solutions that are just very steep are drawn as far as they stay finite.',
    ),
    EX({
      id: 'blow-up',
      title: 'Finite-time blow-up',
      blurb: 'y′ = y² from y(0) = 1: the solution ends at the asymptote t = 1.',
      tex: "y' = y^2",
      lines: [L("y' = y^2", 'ode', { ic: [1], expanded: true }), L('x = 1', 'implicit', { lineStyle: 'dashed', color: '#98a2af' })],
      viewport: { tMin: -4, tMax: 3, yMin: -1, yMax: 8 },
    }),
  ],
};

// ── 4. Sliders & animation ──────────────────────────────────────────────────

const sliders: DocSection = {
  id: 'sliders',
  title: 'Sliders & animation',
  summary: 'Ranges, play modes, speed, autoplay, the shared clock and stepping.',
  blocks: [
    P(
      'Any row of the form `name = number` becomes a slider that every other row can use. Every name you use must be defined, or be one of `x y t r theta` or a constant. If you use an undefined name, the row offers a **Define** button that adds the slider for you.',
    ),
    SYNTAX(
      row('k = 2', 'variable', 'A slider named k'),
      row('w = 2pi', 'variable', 'Constants are fine as values'),
      row('y = k*sin(w*x)', 'function', 'Uses both sliders', {
        with: [L('k = 2', 'variable'), L('w = 1', 'variable', { varMin: 0, varMax: 4 })],
      }),
      row("y' = -k*y", 'ode', 'Sliders work inside ODEs too', { with: [L('k = 0.5', 'variable', { varMin: 0, varMax: 3 })] }),
    ),
    H('Range and step'),
    P(
      'The range defaults to −10 … 10, widened to include the value. Type new limits into the number boxes at either end of the slider. The ‹ › buttons nudge the value by one step.',
    ),
    H('Playing a slider'),
    TABLE(
      ['Control', 'What it does'],
      ['▶ / ❚❚', 'Play or pause'],
      ['Loop', 'Jump back to the start at the end (the default)'],
      ['Bounce', 'Reverse at each end'],
      ['Once', 'Stop at the end'],
      ['Speed', '0.1× to 5×; at 1× a full sweep takes about 4 seconds'],
      ['‹ ›', 'Step back or forward by one slider step'],
    ),
    P('Click the mode button to cycle Loop → Bounce → Once.'),
    EX({
      id: 'travelling-wave',
      title: 'A travelling wave',
      blurb: 'Press ▶ on the a slider: the wave moves and the point rides its crest.',
      lines: [
        L('a = 0', 'variable', { varMin: 0, varMax: 2 * Math.PI, animMode: 'loop', expanded: true }),
        L('y = sin(x - a)', 'function'),
        L('(a + pi/2, 1)', 'points', { pointSize: 6 }),
      ],
      viewport: { tMin: -1, tMax: 8, yMin: -2, yMax: 2 },
    }),
    H('Autoplay'),
    P(
      'A slider can start playing as soon as a graph opens: the built-in Examples do this. Set it with `"autoplay": true` in a JSON spec or `autoplay=1` in a link (see [For AI agents](#agents)). Pausing an autoplaying slider turns autoplay off, so it stays paused next time.',
    ),
    EX({
      id: 'autoplay-lissajous',
      title: 'Autoplaying Lissajous',
      blurb: 'The slider plays on open and drives the curve’s phase and colour.',
      lines: [
        L('a = 0', 'variable', { varMin: 0, varMax: 2 * Math.PI, animMode: 'loop', autoplay: true, expanded: true }),
        L('(3cos(t), 2sin(3t + a))', 'parametric', { lineWidth: 3, colorExpr: 'hsv(57*a, 0.8, 0.85)' }),
      ],
      viewport: { tMin: -5, tMax: 5, yMin: -3, yMax: 3 },
      features: CLEAN,
    }),
    H('One shared clock'),
    P(
      'Every playing slider is advanced by the same clock, in the same frame, so several playing sliders never drift apart. For animations it is simplest to play **one** clock slider (say `T`) and derive everything else from it, e.g. `s = skeys(T, 0, 1, 2, 3)` — see [Drawing & styling](#drawing).',
    ),
    TIP('For a seamless loop, make every quantity return to its starting value at the end of the clock’s range.'),
  ],
};

// ── 5. Inspecting graphs ────────────────────────────────────────────────────

const inspect: DocSection = {
  id: 'inspect',
  title: 'Inspecting graphs',
  summary: 'Markers, tracing a curve, the cross-section panels and significant figures.',
  blocks: [
    H('Markers'),
    P(
      'Fluxion marks interesting points automatically. Hover a marker to read its coordinates. The **Points** button on the graph turns each family on or off.',
    ),
    TABLE(
      ['Marker', 'Meaning'],
      ['Maxima & minima', 'Local extrema of functions and ODE solutions'],
      ['x-intercepts', 'Where a curve crosses y = 0'],
      ['y-intercept', 'Where a curve crosses x = 0'],
      ['Intersections', 'Where two curves meet'],
      ['Discontinuities', 'Removable holes, drawn as hollow dots (asymptotes are just gaps)'],
      ['Endpoints', 'Where a curve stops, e.g. sqrt(x) at 0 (off by default)'],
    ),
    EX({
      id: 'markers',
      title: 'Markers everywhere',
      blurb: 'Extrema, zeros, intersections and a removable hole at x = 0.',
      lines: [L('y = sin(x)/x', 'function'), L('y = cos(x)/2', 'function')],
      viewport: { tMin: -10, tMax: 10, yMin: -1.5, yMax: 1.5 },
    }),
    H('Trace'),
    LIST(
      'Click a curve to pin a trace point on it, with its exact coordinates.',
      'Drag along the curve to move it; it stays on the curve you picked.',
      'Click empty space to clear it.',
    ),
    H('Cross-section panels'),
    P(
      'The two panels read every visible curve along a cut through the graph. Drag the dashed cut line on the graph, or type its position in the panel header. Close a panel with its button and reopen it from the tab at the edge; drag a panel’s edge to resize it.',
    ),
    TABLE(
      ['Panel', 'Cut', 'Shows'],
      ['Right', 'vertical line t = t₀', 'every y where each curve crosses it'],
      ['Bottom', 'horizontal line y = y₀', 'every t where each curve reaches that height'],
    ),
    P(
      'The cut position can be an expression of your sliders: type `k` into the header and the cut follows the `k` slider (handy while it plays).',
    ),
    EX({
      id: 'cross-sections',
      title: 'Reading a family of curves',
      blurb: 'Three solutions of the same ODE; the right panel compares them at t = 2.',
      lines: [
        L("y' = y*(1 - y/4)", 'ode', { ic: [0.5] }),
        L("y' = y*(1 - y/4)", 'ode', { ic: [2] }),
        L("y' = y*(1 - y/4)", 'ode', { ic: [6] }),
      ],
      viewport: { tMin: -1, tMax: 8, yMin: -1, yMax: 7 },
      projections: { rightOpen: true, bottomOpen: true, sliceT: 2, sliceY: 3 },
    }),
    H('Significant figures'),
    P('The **0.0#** selector in the top bar sets how many significant figures every readout shows (2 to 8).'),
  ],
};

// ── 6. Drawing & styling ────────────────────────────────────────────────────

const drawing: DocSection = {
  id: 'drawing',
  title: 'Drawing & styling',
  summary: 'Functions, repeats, derived values, keyframe and 3D helpers, colours, styles and layers.',
  blocks: [
    P(
      'Graph mode has a few scripting features for making drawings and animations: your own functions, repeated copies, live derived values and a set of helper functions. The built-in **Examples** (share menu) are built entirely from them.',
    ),
    H('Your own functions'),
    P(
      '`f(u, v) = …` defines a function you can call in any row. Order doesn’t matter. A one-parameter definition like `f(x) = x^2` is also drawn.',
    ),
    SYNTAX(
      row('f(u) = u^2 - a', 'fndef', 'Define f (uses the slider a)', {
        with: [L('a = 1', 'variable'), L('y = f(x) - 1', 'function')],
      }),
      row('g(u, v) = hypot(u, v)', 'fndef', 'Several parameters', { with: [L('y = g(x, 1)', 'function')] }),
      row('h(u) = u < 0 ? 0 : u', 'fndef', 'Piecewise with a ternary', { with: [L('y = h(x)', 'function')] }),
    ),
    H('Derived values'),
    P(
      '`name = expression` without x or y is a value that updates live as its sliders change; the row shows its current value.',
    ),
    SYNTAX(
      row('b = 2a + 1', 'function', 'A derived value', {
        derived: true, with: [L('a = 1', 'variable'), L('y = b', 'function')] }),
    ),
    H('Repeats'),
    P(
      '`… for k = a..b` draws a curve, point, polygon or region once for every value of k. Use `step` for other spacings and several loops for grids (up to 2000 copies). A repeated region is the union of its copies.',
    ),
    SYNTAX(
      row('(cos(t) + 3k, sin(t)) for k = -1..1', 'repeat', 'Three circles'),
      row('(k, k^2/4) for k = -4..4', 'repeat', 'Nine points'),
      row('(x - 3k)^2 + y^2 < 1 for k = -1..1', 'repeat', 'Three discs (one region)'),
      row('y = k*x for k = 0..6 step 2', 'repeat', 'A step size'),
      row('(i, j) for i = 0..3, j = 0..3', 'repeat', 'A 4 × 4 grid of points'),
    ),
    H('Helper functions'),
    P('These work in every row, and are the building blocks of keyframed animation and 3D drawings.'),
    TABLE(
      ['Helper', 'What it gives'],
      ['`lerp(a, b, u)` or `mix(a, b, u)`', 'a + (b − a)·u, straight-line blend'],
      ['`clamp(x, lo, hi)`', 'x limited to [lo, hi] (default 0 … 1)'],
      ['`smoothstep(e0, e1, x)`', '0 below e0, 1 above e1, smooth between'],
      ['`ease(u)`', 'Ease-in-out of u in 0 … 1'],
      ['`step(x)`', '1 when x ≥ 0, else 0'],
      ['`pulse(x, a, b)`', '1 when a ≤ x < b, else 0'],
      ['`keys(T, t0, v0, t1, v1, …)`', 'Keyframe track: linear between (time, value) pairs, held flat outside'],
      ['`skeys(T, t0, v0, …)`', 'Same, eased into and out of each key'],
      ['`rotx(x, y, a)`, `roty(x, y, a)`', 'x and y of the point (x, y) rotated by angle a'],
      ['`projx(x, y, z, yaw, pitch, dist)`, `projy(…)`', 'Screen x and y of a 3D point (dist = camera distance; 0 = orthographic)'],
      ['`projz(x, y, z, yaw, pitch)`', 'Depth after rotating, for sorting or fading far parts'],
    ),
    EX({
      id: 'keyframes',
      title: 'Keyframed circle',
      blurb: 'One clock T; skeys eases the radius 1 → 3 → 1 while rotx/roty spin a point.',
      lines: [
        L('T = 0', 'variable', { varMin: 0, varMax: 4, animMode: 'loop', autoplay: true, expanded: true }),
        { ...L('s = skeys(T, 0, 1, 2, 3, 4, 1)', 'function'), derived: true },
        L('(s*cos(t), s*sin(t))', 'parametric', { lineWidth: 3, fill: true, fillOpacity: 0.15 }),
        L('(rotx(s, 0, pi*T/2), roty(s, 0, pi*T/2))', 'points', { pointSize: 7 }),
      ],
      viewport: { tMin: -5, tMax: 5, yMin: -3.5, yMax: 3.5 },
      features: CLEAN,
    }),
    EX({
      id: 'cube-demo',
      title: 'Rotating cube',
      blurb: 'A built-in Example: 3D vertices projected with projx / projy.',
      lines: [],
      demo: 'cube',
    }),
    H('Colour expressions'),
    P(
      'A colour can be an expression of your sliders, so it can animate. Right-click a row’s colour dot and type it into **Colour** (line) or the fill box below it.',
    ),
    TABLE(
      ['Colour', 'Arguments'],
      ['`rgb(r, g, b)`, `rgba(r, g, b, a)`', 'r g b from 0 to 255, alpha 0 to 1'],
      ['`hsv(h, s, v)`, `hsva(…, a)`', 'hue in degrees, the rest 0 to 1'],
      ['`hsl(h, s, l)`, `hsla(…, a)`', 'hue in degrees, the rest 0 to 1'],
      ['`gray(v)`', 'grey level 0 to 1'],
      ['`mixc(c1, c2, u)`, `alpha(c, a)`', 'blend two colours; change a colour’s alpha'],
      ['`#ff8800`, `teal`', 'a fixed colour'],
    ),
    H('Line, fill and layers'),
    LIST(
      '**Click** a row’s colour dot to hide or show it; **right-click** it for the style popover: palette and custom colour, line width (0 hides the line), solid / dashed / dotted, fill on/off and opacity for closed shapes, colour expressions, and point options.',
      'Inequalities are filled automatically. Parametric and polar curves, polylines and clips can be filled when closed.',
      '**Layering**: rows draw in list order, so later rows are on top. Drag a row by its ⠿ grip to move it.',
      '**Grid & axes**: switch them off in the Points menu on the graph for a clean canvas.',
    ),
    EX({
      id: 'styled-shapes',
      title: 'Styled shapes',
      blurb: 'A borderless filled disc under a dashed outline and a thick dotted polygon.',
      lines: [
        L('(2cos(t), 2sin(t))', 'parametric', { lineWidth: 0, fill: true, fillOpacity: 0.35, fillColor: 'hsv(200, 0.6, 0.9)' }),
        L('(2.5cos(t), 2.5sin(t))', 'parametric', { lineStyle: 'dashed' }),
        L('((-3, -2), (0, 3), (3, -2), (-3, -2))', 'points', { lineWidth: 4, lineStyle: 'dotted', fill: true, fillOpacity: 0.1 }),
      ],
      viewport: { tMin: -6, tMax: 6, yMin: -4, yMax: 4 },
      features: CLEAN,
    }),
    H('Examples'),
    P(
      'The share menu’s **Examples** open complete drawings: Rotating Sharingan, Rotating cube, Eye → Sharingan → Mangekyō, Mandala bloom, Pendulum from an ODE and Silhouette clip. They are written as short **Script mode** programs (see Scripting below), which is the easier way to make drawings like these. **Cinematic sunset** is the exception: a Graph-mode scene made with the [animation features](#animation). Opening one replaces your graph, with **Undo** in the notice that appears.',
    ),
    EX({ id: 'mandala-demo', title: 'Mandala bloom', blurb: 'A petal() helper in three counter-rotating rings, on one looping clock.', lines: [], demo: 'mandala' }),
  ],
};

// ── 6b. Animation & performance ────────────────────────────────────────────

const SKY = 'linear(0, 6, 0, -6, #0b1d3a, #f28c38)';

const animation: DocSection = {
  id: 'animation',
  title: 'Animation & performance',
  summary: 'Smooth paths, locals, gradients, glow and blend modes, layers, letterbox frames and exact frame timing.',
  blocks: [
    P(
      'Everything here is optional and lives in the style popover’s **Advanced** section, in the row syntax, or in a link / JSON spec ([For AI agents](#agents)). A graph that doesn’t use it looks and behaves exactly as before.',
    ),
    H('It’s already fast'),
    P(
      'Every row is compiled once. A part of an expression that doesn’t change along a curve (say a drift term `mod(T*0.4 + 3k, 48)` in a `for` repeat) is computed once per copy, not at every sample, and a term that appears twice is computed once. Shapes that are entirely off-screen are skipped. Write the natural formula.',
    ),
    LIST(
      '**Samples** (Advanced): a row’s own resolution, 8 to 20000. Raise it for a smooth hero curve, lower it for a sky full of soft shapes.',
    ),
    H('Local definitions'),
    P('`… where a = …, b = …` names parts of one row. Later locals may use earlier ones and the loop variable of a `for`.'),
    SYNTAX(
      row('y = a*x^2 + a where a = 0.5', 'function', 'A local a'),
      row('(s*cos(t) + 3k, s*sin(t)) where s = 1 + 0.2sin(5t) for k = -1..1', 'repeat', 'Locals in a repeat'),
    ),
    H('Smooth paths'),
    P(
      '`spline(P0, P1, …)` draws a smooth curve through points (closed and smooth when the last point equals the first). Inside a polyline, `spline(…)` runs smoothly from the previous point, and `bezier((c1), (c2), (end))`, `bezier((c), (end))` and `arc((cx, cy), angle)` continue from it, so one outline mixes sharp corners and curves. Smooth paths have no vertex dots; the **Vertex dots** switch (Advanced) shows or hides dots on any polyline.',
    ),
    SYNTAX(
      row('spline((-4, -1), (-2, 2), (0, 0), (2, 2), (4, -1))', 'points', 'Through five points'),
      row('spline((2, 0), (0, 2), (-2, 0), (0, -2), (2, 0))', 'points', 'A closed blob', { opts: { fill: true } }),
      row('((-3, -2), (0, 3), spline((1, 1), (2, 0)), bezier((3, -1), (2, -2), (-3, -2)))', 'points', 'Corners, a spline and a Bézier', { opts: { fill: true } }),
      row('((2, 0), arc((0, 0), pi), (-2, -2))', 'points', 'An arc by π around the origin'),
    ),
    H('Gradients, glow and blend modes'),
    P('Fill and line colours can be gradients, in graph coordinates. In a `for` repeat, colours may use the loop variable, so every copy can differ.'),
    TABLE(
      ['Colour', 'Arguments'],
      ['`linear(x0, y0, x1, y1, c0, c1, …)`', 'from (x0, y0) to (x1, y1); colours evenly spaced, or `offset, colour` pairs'],
      ['`radial(cx, cy, r, c0, c1, …)`', 'from the centre out to radius r'],
    ),
    LIST(
      '**Blend** (Advanced): `add` makes light add up (rays, flashes), `screen` is softer; also multiply, overlay, lighten, darken.',
      '**Glow** and **Blur** (Advanced): a soft halo or a blur, radius in px. Use them on a few shapes; they are costly on thousands.',
    ),
    EX({
      id: 'sunset',
      title: 'Sky, sun and hills',
      blurb: 'One gradient rectangle for the sky, a radial glow in screen blend, a spline hill and per-copy cloud colours.',
      lines: [
        L('((-10, -6), (10, -6), (10, 6), (-10, 6))', 'points', { fill: true, fillOpacity: 1, lineWidth: 0, fillColor: SKY }),
        L('(2cos(t) + 4, 2sin(t) + 1)', 'parametric', {
          fill: true, fillOpacity: 1, lineWidth: 0, blend: 'screen',
          fillColor: 'radial(4, 1, 2, rgba(255, 240, 200, 1), rgba(255, 170, 80, 0))',
        }),
        L('(1.2cos(t) + 3k - 8, 0.5sin(t) + 4) for k = 0..5', 'repeat', { fill: true, fillOpacity: 0.9, lineWidth: 0, fillColor: 'hsv(210, 0.06k, 1)', samples: 64 }),
        L('spline((-10, -6), (-6, -2), (-1, -4), (4, -1.5), (10, -6))', 'points', { fill: true, fillOpacity: 1, lineWidth: 0, color: '#000000' }),
      ],
      viewport: WIDE,
      features: CLEAN,
    }),
    H('Layers and the camera'),
    P(
      'A row `name = layer(dx, dy, scale, angle, cx, cy)` (only dx and dy are needed; scale and rotation are about (cx, cy)) is a transform driven by sliders. Rows whose **Layer** (Advanced) is that name move with it and are drawn at the layer row’s place in the list, so dragging the layer row changes their depth. A layer called `camera` moves everything: a pan, a zoom or a shake is one value. Moving a layer never recomputes the curves.',
    ),
    SYNTAX(
      row('far = layer(-0.2T, 0)', 'layer', 'Moves slower than the rest: parallax', {
        with: [
          L('T = 0', 'variable', { varMin: 0, varMax: 20, animMode: 'loop' }),
          L('(cos(t) + 2, sin(t) + 1)', 'parametric', { layer: 'far', fill: true }),
        ],
      }),
      row('camera = layer(0.05sin(40T), 0, 1 + 0.01T)', 'layer', 'Shake and a slow zoom', {
        with: [L('T = 1', 'variable'), L('(cos(t), sin(t))', 'parametric')],
      }),
    ),
    H('Frames and time'),
    LIST(
      '`aspect` (link / spec): letterbox the plot to a fixed frame such as 2.39 or 16/9, with black bars; the x-range spans the frame exactly, so it looks the same on every screen.',
      '`fps`: deterministic playback. Sliders advance in whole frames, and frame N always looks the same.',
      '`time` / `frame`: open a link paused at an exact moment (`…&frame=120`), handy for rendering frames one by one. In the page, `fluxion.setFrame(n)` and `fluxion.capture()` do the same from a script.',
    ),
    TIP('Drive everything from one clock slider `T` and derive the rest from it; with `fps` set, the whole animation is a pure function of the frame number.'),
  ],
};

// ── 7. Clips ────────────────────────────────────────────────────────────────

const clips: DocSection = {
  id: 'clips',
  title: 'Clips',
  summary: 'Play a short black-and-white video as filled outlines.',
  blocks: [
    P(
      'A **clip** is a short black-and-white video turned into a sequence of filled outlines, one per frame, so it plays crisply at any zoom. Import one in **Script mode → Clips** (a video, a GIF or a set of images; it all happens in your browser), give it a name, and play it from a script with `clip("name").play()`. The Scripting reference has the details.',
    ),
    P(
      'Graph files made before Script mode play clips with a row `frames(i)`, which draws frame number i of the clip attached to that row; a clock slider drives i.',
    ),
    SYNTAX(
      row('frames(30*T)', 'frames', 'Frame 30·T of the row’s clip (30 frames per second of T)', {
        with: [L('T = 0', 'variable')],
      }),
    ),
    P(
      'The **Silhouette clip** Example plays one.',
    ),
    EX({ id: 'silhouette-demo', title: 'Silhouette clip', blurb: 'A built-in clip played with clip("apple").play().', lines: [], demo: 'silhouette' }),
    H('Long clips: the command-line importer'),
    P('The in-app importer takes up to a minute of video. For longer clips, with a copy of the repository and ffmpeg:'),
    STEPS(
      'Extract small black-and-white frames: `ffmpeg -i clip.mp4 -vf "fps=30,scale=192:144" frames/%05d.pgm`',
      'Trace them into a graph file: `npx vite-node scripts/frames-import.ts -- frames clip.fluxion.json --fps 30`',
      'In Fluxion: share menu → **Import from file…** → choose `clip.fluxion.json`. It opens in Script mode, playing the clip.',
    ),
    P(
      'Options include `--threshold`, `--invert`, `--every` and `--width`; run the script without arguments for the list. Everything runs on your machine. A clip travels inside exported files and share links, but not in JSON specs.',
    ),
  ],
};

// ── 8. Sharing, export & import ─────────────────────────────────────────────

const sharing: DocSection = {
  id: 'sharing',
  title: 'Saving, sharing & export',
  summary: 'My graphs, recent work, share links, JSON files and importing.',
  blocks: [
    P('Everything is in the **share menu** in the top bar; **My graphs** also opens from the graph’s name next to the logo.'),
    TABLE(
      ['Item', 'What it does'],
      ['Save (Ctrl/⌘+S)', 'Save the graph under a name; saving again updates it'],
      ['Save as copy', 'Keep the saved version and save this one under a new name'],
      ['New graph', 'Start a blank graph; the current one stays in My graphs or Recent'],
      ['My graphs…', 'Your saved graphs and recent unsaved work'],
      ['Copy share link', 'A link that opens exactly this graph: rows, styles, view and panels'],
      ['Copy as JSON spec', 'A readable description of the graph, ideal to paste to an AI assistant'],
      ['Export to file…', 'Download the graph as `fluxion-graph.json`'],
      ['Import from file…', 'Open an exported file or a JSON spec'],
      ['Examples', 'Open a built-in scripted drawing (with Undo)'],
    ),
    H('Links'),
    LIST(
      'The graph lives in the link after `#`, so it is never sent to a server.',
      'Opening a link replaces the graph in that tab, then tidies the address bar.',
      'A broken link never blanks the page: your graph stays and a message explains the problem.',
    ),
    H('My graphs'),
    LIST(
      'Each saved graph shows a thumbnail, its name and when it was last edited. Click one to open it.',
      'The **⋯** button on an item renames, duplicates, copies a share link, exports to a file or deletes it. A deleted graph can be brought back with **Undo**.',
      'Next to the name, **Saved** or **Unsaved changes** tells you whether the graph matches its saved version.',
      'Type in the search box to filter a long list.',
    ),
    H('Recent work'),
    LIST(
      'Unsaved graphs you have edited are kept automatically under **Recent**: the last 10, from every tab, without duplicates.',
      'Closing a tab or opening another graph never loses work: open it from Recent, or press **Keep** to save it under a name.',
    ),
    H('Several tabs'),
    LIST(
      'Each tab edits its own graph. Saving in one tab updates the list in the others.',
      'If another tab saved a newer version of the graph you are editing, the name shows **Changed in another tab**. Saving then asks whether to save a copy, overwrite, or open the other version, so nothing is overwritten by accident.',
    ),
    H('Where it is stored'),
    LIST(
      'Graphs are stored in this browser only; nothing is uploaded. To move a graph to another device, export it or copy a share link.',
      'In a private window the browser may not keep anything after it closes; export graphs you want to keep.',
    ),
    TIP('**Try it** in these docs opens the example in a new tab, so the graph in your other tab is untouched. The Examples menu replaces your graph, but the notice that appears has an **Undo** button for a few seconds.'),
  ],
};

// ── 9. Keyboard & tips ──────────────────────────────────────────────────────

const keyboard: DocSection = {
  id: 'keyboard',
  title: 'Keyboard & tips',
  summary: 'Shortcuts, typing tips and common mistakes.',
  blocks: [
    TABLE(
      ['Key', 'Where', 'Action'],
      ['Ctrl/⌘+S', 'anywhere', 'Save the graph (asks for a name the first time)'],
      ['Enter', 'expression row', 'Finish editing'],
      ['↑ ↓', 'autocomplete', 'Choose a suggestion'],
      ['Tab or Enter', 'autocomplete', 'Accept the suggestion'],
      ['Esc', 'autocomplete', 'Dismiss suggestions'],
      ['Esc', 'tour', 'Close'],
      ['← →', 'tour', 'Previous / next card'],
      ['/', 'these docs', 'Jump to the search box'],
      ['Scroll', 'graph', 'Zoom around the cursor'],
      ['Drag', 'graph', 'Pan (or trace, when you grab a curve)'],
    ),
    H('Typing tips'),
    LIST(
      'Type `theta`, `alpha`, `pi` … and they become Greek letters.',
      'Autocomplete suggests functions, constants and your own names as you type.',
      'Put an operator or a space between names: `pi*x` or `pi x`, not `pix`.',
      '`P(1 - P)` calls a function named P; write `P*(1 - P)`.',
      'Functions need parentheses: `sin(x)`, not `sin x`.',
      'Use `abs(x)`, not `|x|`. For piecewise shapes use a ternary inside a function, or `min`, `max` and `step`.',
      'Don’t name a slider `e`, `pi`, `t`, `x`, `y`, `r` or `theta`; they already mean something.',
      'A red **!** on a row means it couldn’t be read; hover it for the reason.',
    ),
    H('Common mistakes'),
    TABLE(
      ['Instead of', 'Write'],
      ["`y' = x*y`", "`y' = t*y`"],
      ['`y = sin(πx)`', '`y = sin(pi*x)`'],
      ["`P' = P(1 - P)`", "`P' = P*(1 - P)`"],
      ['`y = |x|`', '`y = abs(x)`'],
      ['`y = sin x`', '`y = sin(x)`'],
    ),
  ],
};

// ── 10. For AI agents ───────────────────────────────────────────────────────

const agents: DocSection = {
  id: 'agents',
  title: 'For AI agents',
  summary: 'Let an assistant build graphs for you with links.',
  blocks: [
    P(
      'An AI assistant can make a Fluxion graph by writing a link: no API key, no backend. Point it at the agent guide and it will hand back a link that opens straight to the plot.',
    ),
    LIST(
      '[llms.txt](../llms.txt): the full agent guide, with syntax, examples and link formats.',
      '[fluxion-spec.schema.json](../fluxion-spec.schema.json): the JSON Schema for graph specs.',
      '[examples/index.json](../examples/index.json): the built-in Examples as editable specs.',
    ),
    TABLE(
      ['Link', 'Opens'],
      ['`#expr=y=sin(x)`', 'One or more expressions, with options such as `ic`, `min`, `color`'],
      ['`#spec=…` or `#z=…`', 'A full JSON spec (readable, or compressed)'],
      ['`#example=mandala`', 'A built-in Example by id'],
      ['`docs/#odes`', 'These docs, at a section'],
    ),
    P('To have an assistant edit your graph: share menu → **Copy as JSON spec**, paste it to the assistant, and open the link it returns.'),
  ],
};

// ── 11. Scripting (Script mode) ─────────────────────────────────────────────

const scripting: DocSection = {
  id: 'scripting',
  title: 'Scripting',
  summary: 'Script mode: write JavaScript that draws and animates on the graph.',
  blocks: [
    P(
      'Switch the header to **Script** and the expression list becomes a code editor beside the same canvas. A script is plain JavaScript with drawing functions built in — `circle`, `polygon`, `path`, `curve`, `text`, `group`, `hsv`, `keyframes`, `slider`, `camera` and more — drawn on the graph\'s own axes, so pan and zoom still work. Scripts that use `time` animate.',
    ),
    P(
      'A script can read Graph mode: `graph.ode("theta")(t)` is the solution of the differential equation you typed, at any time t (the **Pendulum from an ODE** example swings along it). Scripts run in a sandbox: they can draw, but can\'t reach the page, your storage or the internet, and they travel in share links and files with the graph.',
    ),
    { type: 'script-docs' },
  ],
};

/** All sections, in learning order. */
export const SECTIONS: DocSection[] = [
  gettingStarted,
  curves,
  odes,
  sliders,
  inspect,
  drawing,
  animation,
  clips,
  sharing,
  keyboard,
  agents,
  scripting,
];

export const HOME_ID = SECTIONS[0].id;

export function findSection(id: string | undefined): DocSection | undefined {
  return SECTIONS.find((s) => s.id === id);
}

/** The example a syntax row's "Try it" loads: its `with` rows, then the row. */
export function rowExample(sectionId: string, r: SyntaxRow, index: number): DocExample {
  return {
    id: `${sectionId}-row-${index}`,
    title: r.input,
    lines: [...(r.with ?? []), { raw: r.input, kind: r.kind, opts: r.opts, derived: r.derived }],
    viewport: r.viewport ?? WIDE,
  };
}

/** Every example in the docs (explicit examples and syntax rows), with its section. */
export function allExamples(): { section: DocSection; example: DocExample }[] {
  const out: { section: DocSection; example: DocExample }[] = [];
  for (const section of SECTIONS) {
    let n = 0;
    for (const b of section.blocks) {
      if (b.type === 'example') out.push({ section, example: b.example });
      else if (b.type === 'syntax') for (const r of b.rows) out.push({ section, example: rowExample(section.id, r, n++) });
    }
  }
  return out;
}
