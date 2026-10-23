import { parseEntry, type Parsed } from '../math/parse';
import { computeAll, type CurveResult } from '../compute';
import type { GraphData } from '../graphFile';
import type { Viewport } from '../../store/types';
import { colorExprCalls } from '../color';
import { isDerived, isPlottableFnDef } from '../scope';
import { specToGraph, validateSpec, type Issue, type NormalizedSpec } from './spec';

/**
 * Headless "will this graph actually work?" check for agents. Runs the strict
 * structural validation, then the app's real parser + compute pipeline on every
 * expression, and reports what each one was understood as plus anything that
 * would make it fail to draw (parse errors, unknown functions, undefined
 * variables, options that don't apply, nothing visible in the viewport).
 */

export type ExprKind = Parsed['kind'];

export interface ExpressionReport {
  index: number;
  expr: string;
  kind: ExprKind;
  /** Short human summary, e.g. "2nd-order ODE in y", "slider k = 2". */
  summary: string;
  /** Number of drawn segments / points inside the viewport (plottable kinds). */
  visible?: boolean;
}

export interface CheckReport {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  expressions: ExpressionReport[];
  /** The normalised spec, when structurally valid. */
  spec?: NormalizedSpec;
}

const ORDINAL = ['', '1st', '2nd', '3rd'];
const ord = (n: number) => ORDINAL[n] ?? `${n}th`;

function summarize(p: Parsed): string {
  switch (p.kind) {
    case 'function':
      if ((isDerived as (x: Parsed) => boolean)(p)) return `derived value ${p.name}`;
      return p.name === 'y' ? 'function y(x)' : `function ${p.name}(x)`;
    case 'ode':
      return `${ord(p.order)}-order ODE in ${p.depVar}(t)`;
    case 'variable':
      return `slider ${p.name} = ${p.value}`;
    case 'implicit':
      return 'implicit curve F(x, y) = 0';
    case 'polar':
      return 'polar curve r(θ)';
    case 'inequality':
      return p.polar ? 'shaded polar region' : 'shaded region';
    case 'layer':
      return `layer ${p.name} (a shared transform for entries with "layer": "${p.name}")`;
    case 'points':
      if (p.smooth) return 'smooth path (spline / bezier / arc)';
      return p.polyline
        ? `polyline through ${p.points.length} points`
        : `${p.points.length} point${p.points.length === 1 ? '' : 's'}`;
    case 'pointvar':
      return `point ${p.name}`;
    case 'parametric':
      return 'parametric curve (x(t), y(t))';
    case 'fndef':
      return `function definition ${p.name}(${p.params.join(', ')})`;
    case 'repeat':
      return `${summarize(p.body)}, repeated for ${p.loops.map((l) => `${l.name} = ${l.text}`).join(', ')}`;
    case 'frames':
      return 'frame sequence (needs an imported clip)';
    case 'empty':
      return 'empty';
    case 'error':
      return `error: ${p.message}`;
  }
}

/** Does any part of the result fall inside the viewport? */
function anyVisible(r: CurveResult, vp: Viewport, filled = false): boolean {
  const inside = (t: number, y: number) => t >= vp.tMin && t <= vp.tMax && y >= vp.yMin && y <= vp.yMax;
  if (r.points?.some(([t, y]) => inside(t, y))) return true;
  // A phase-plane ODE draws its state-space curve (only on the group's first row).
  if (r.ode?.phase) {
    if (!r.ode.isLeader) return true;
    for (const seg of r.ode.phase.curve?.segments ?? []) for (const [x, y] of seg) if (inside(x, y)) return true;
    return false;
  }
  for (const seg of r.curve.segments) for (const [t, y] of seg) if (inside(t, y)) return true;
  // A filled shape bigger than the view (a sky, a backdrop) covers its centre.
  if (filled) {
    const cx = (vp.tMin + vp.tMax) / 2;
    const cy = (vp.yMin + vp.yMax) / 2;
    for (const seg of r.curve.segments) {
      if (seg.length < 3) continue;
      let inPoly = false;
      for (let i = 0, j = seg.length - 1; i < seg.length; j = i++) {
        const [xi, yi] = seg[i];
        const [xj, yj] = seg[j];
        if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inPoly = !inPoly;
      }
      if (inPoly) return true;
    }
  }
  if (r.inequality) {
    // Probe a coarse grid for any shaded cell.
    const N = 24;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const t = vp.tMin + ((vp.tMax - vp.tMin) * i) / N;
        const y = vp.yMin + ((vp.yMax - vp.yMin) * j) / N;
        if (r.inequality.test(t, y)) return true;
      }
    }
  }
  return false;
}

/** Semantic check of an already-built graph (shared by checkSpec and the CLI). */
export function checkGraph(g: GraphData, pathOf: (i: number) => string = (i) => `expressions[${i}]`) {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const expressions: ExpressionReport[] = [];
  const results = computeAll(g.entries, g.viewport);
  const vp = g.viewport;
  const fnNames = new Set(
    g.entries.map((e) => parseEntry(e.raw)).flatMap((p) => (p.kind === 'fndef' ? [p.name] : [])),
  );
  const layerNames = new Set(
    g.entries.map((e) => parseEntry(e.raw)).flatMap((p) => (p.kind === 'layer' ? [p.name] : [])),
  );

  g.entries.forEach((entry, i) => {
    const parsed = parseEntry(entry.raw);
    const res = results.get(entry.id);
    const path = pathOf(i);
    const rep: ExpressionReport = { index: i, expr: entry.raw, kind: parsed.kind, summary: summarize(parsed) };
    expressions.push(rep);

    if (parsed.kind === 'error') {
      errors.push({ path, message: `cannot parse "${entry.raw}": ${parsed.message}` });
      return;
    }
    if (res?.unknownFns?.length) {
      errors.push({
        path,
        message: `unknown function ${res.unknownFns.join(', ')} in "${entry.raw}" (define it first, e.g. "${res.unknownFns[0]}(u) = u^2")`,
      });
    }
    if (res?.undefinedVars?.length) {
      const names = res.undefinedVars;
      const hint =
        parsed.kind === 'ode' && names.includes('x')
          ? ' ODEs always use t as the independent variable (write y\' = t*y, not y\' = x*y).'
          : ` Add a slider expression such as "${names[0]} = 1".`;
      errors.push({ path, message: `undefined variable${names.length > 1 ? 's' : ''} ${names.join(', ')}.${hint}` });
    } else if (res?.error && !res.unknownFns?.length) {
      errors.push({ path, message: res.error });
    }

    // Options that don't apply to this kind are ignored by the app — flag them.
    const body = parsed.kind === 'repeat' ? parsed.body : parsed;
    const isPolar =
      body.kind === 'polar' || body.kind === 'parametric' || (body.kind === 'inequality' && body.polar);
    // A repeated point list is still points (the cube's vertices, the mandala's seeds).
    const isPoint = body.kind === 'points' || body.kind === 'pointvar';
    const misplaced: [boolean, string, string][] = [
      [entry.t0 !== undefined || entry.ic !== undefined, 't0/ic', 'ODEs'],
      [
        entry.varMin !== undefined || entry.varMax !== undefined || entry.varStep !== undefined,
        'min/max/step',
        'sliders (k = 2)',
      ],
      [
        entry.thetaMin !== undefined || entry.thetaMax !== undefined,
        'thetaMin/thetaMax',
        'polar curves/regions and parametric curves (as the t-range)',
      ],
      [entry.autoplay !== undefined, 'autoplay', 'sliders (k = 2)'],
      [
        entry.pointLabel !== undefined || entry.pointSize !== undefined || entry.pointDrag !== undefined || entry.pointLabelDir !== undefined,
        'label/labelDir/pointSize/drag',
        'points',
      ],
    ];
    const applies: Record<string, boolean> = {
      't0/ic': parsed.kind === 'ode',
      'min/max/step': parsed.kind === 'variable',
      autoplay: parsed.kind === 'variable',
      'thetaMin/thetaMax': isPolar,
      'label/labelDir/pointSize/drag': isPoint,
    };
    for (const [present, what, forWhat] of misplaced) {
      if (present && !applies[what]) {
        warnings.push({ path, message: `${what} only apply to ${forWhat}; ignored for this ${parsed.kind} expression` });
      }
    }
    // Colour expressions may call built-ins and the graph's own functions only.
    for (const [k, v] of [['colorExpr', entry.colorExpr], ['fillColor', entry.fillColor]] as const) {
      if (!v) continue;
      const missing = colorExprCalls(v).filter((f) => !fnNames.has(f));
      if (missing.length) errors.push({ path: `${path}.${k}`, message: `unknown function ${missing.join(', ')} in "${v}"` });
    }
    // Animation options.
    if (entry.layer && !layerNames.has(entry.layer)) {
      warnings.push({
        path: `${path}.layer`,
        message: `no layer called "${entry.layer}": add a row like "${entry.layer} = layer(0, 0)"; drawn without a transform`,
      });
    }
    if (entry.samples !== undefined && !['function', 'parametric', 'polar', 'implicit', 'inequality', 'points', 'fndef'].includes(body.kind)) {
      warnings.push({ path: `${path}.samples`, message: `samples only apply to curves and regions; ignored for this ${parsed.kind} expression` });
    }
    if (entry.dots !== undefined && !(body.kind === 'points' && body.polyline)) {
      warnings.push({ path: `${path}.dots`, message: 'dots only apply to polylines and paths; ignored' });
    }
    if ((entry.glow ?? 0) + (entry.blur ?? 0) > 30 && (res?.copies ?? 1) > 50) {
      warnings.push({ path, message: 'glow / blur on many copies is slow to draw; consider fewer copies or a smaller radius' });
    }
    if (parsed.kind === 'ode' && entry.ic && entry.ic.length > parsed.order) {
      warnings.push({
        path: `${path}.ic`,
        message: `"${entry.raw}" is ${ord(parsed.order)} order, so ic takes ${parsed.order} value${parsed.order > 1 ? 's' : ''} [${['y(t0)', "y'(t0)", "y''(t0)"].slice(0, parsed.order).join(', ')}…]; extra values ignored`,
      });
    }
    // ODE view options (lib/ode): apply only where the equation allows them.
    const odeRes = res?.ode;
    if (parsed.kind !== 'ode') {
      for (const k of ['field', 'phase', 'phaseAxes', 'extraICs'] as const) {
        if (entry[k] !== undefined) warnings.push({ path: `${path}.${k}`, message: `${k} only applies to ODEs; ignored for this ${parsed.kind} expression` });
      }
    } else if (odeRes) {
      if (entry.phase && odeRes.dim < 2) {
        warnings.push({
          path: `${path}.phase`,
          message: `"${entry.raw}" has a 1-D state, so there is no phase plane (use a 2nd-order equation or a system like x' = …, y' = …); drawn against t`,
        });
      }
      if (entry.phaseAxes) {
        const names = odeRes.stateLabels.map((s) => s.replace(/′/g, "'"));
        const bad = entry.phaseAxes.filter((n) => !names.includes(n));
        if (bad.length) {
          warnings.push({ path: `${path}.phaseAxes`, message: `no state variable ${bad.join(', ')} (this system has ${names.join(', ')}); using ${names.slice(0, 2).join(', ')}` });
        }
      }
      if (entry.field === true && !odeRes.fieldKind) {
        warnings.push({
          path: `${path}.field`,
          message: 'a field needs a first-order equation (slope field) or a 2-D system in the phase plane; ignored',
        });
      }
      const bad = (entry.extraICs ?? []).findIndex((v) => v.length !== odeRes.dim + 1);
      if (bad >= 0) {
        warnings.push({
          path: `${path}.extraICs[${bad}]`,
          message: `each extra solution is [t0, …state] with ${odeRes.dim + 1} numbers for this ${odeRes.dim}-D system; ignored`,
        });
      }
    }
    if (entry.family !== undefined && parsed.kind !== 'variable') {
      warnings.push({ path: `${path}.family`, message: `family only applies to sliders (k = 2); ignored for this ${parsed.kind} expression` });
    }
    if (parsed.kind === 'variable') {
      const v = entry.varValue ?? parsed.value;
      if ((entry.varMin !== undefined && v < entry.varMin) || (entry.varMax !== undefined && v > entry.varMax)) {
        warnings.push({ path, message: `slider value ${v} is outside [min, max]` });
      }
    }

    // Derived values (b = 2a) and helper definitions (f(u, v) = …) draw nothing by design.
    const plottable =
      !['empty', 'variable', 'error', 'layer'].includes(parsed.kind) &&
      res?.value === undefined &&
      !(parsed.kind === 'fndef' && !isPlottableFnDef(parsed));
    // (Entries on a layer are moved at draw time, so their data position isn't where they show.)
    if (plottable && res && !res.error && !res.undefinedVars?.length && entry.visible && !entry.layer) {
      rep.visible = anyVisible(res, vp, !!entry.fill);
      if (!rep.visible) {
        warnings.push({
          path,
          message: `"${entry.raw}" draws nothing inside the viewport x∈[${vp.tMin}, ${vp.tMax}], y∈[${vp.yMin}, ${vp.yMax}] — widen the viewport?`,
        });
      }
    }
  });

  return { errors, warnings, expressions };
}

/** Typical plot-area height/width on a desktop screen (the app's default layout). */
export const TYPICAL_ASPECT = 0.75;

/**
 * The plot always keeps a square grid: x-range is honoured exactly and the
 * y-range is re-derived from the canvas shape, centred on (ymin+ymax)/2. Warn
 * when the requested y-range is far from what will actually show.
 */
function aspectWarning(spec: NormalizedSpec): Issue | null {
  const { tMin, tMax, yMin, yMax } = spec.viewport;
  const ratio = (yMax - yMin) / (tMax - tMin);
  if (ratio > 0.3 && ratio < 1.6) return null;
  const shown = Number(((tMax - tMin) * TYPICAL_ASPECT).toPrecision(2));
  const c = Number(((yMin + yMax) / 2).toPrecision(3));
  return {
    path: 'viewport',
    message:
      `Fluxion keeps x and y at the same scale, so only xmin/xmax are exact: y will show about ${shown} units ` +
      `centred on ${c} (not ${yMin}…${yMax}). Widen or narrow the x-range to match, or rescale the equation.`,
  };
}

/** Validate a spec structurally and semantically. Never throws. */
export function checkSpec(input: unknown): CheckReport {
  const v = validateSpec(input);
  if (!v.ok) return { ok: false, errors: v.errors, warnings: v.warnings, expressions: [] };
  const g = specToGraph(v.spec);
  const sem = checkGraph(g);
  const errors = sem.errors;
  // Only when the caller asked for a y-range (the default one is never 'wrong').
  const vpIn = (input as { viewport?: Record<string, unknown> } | null)?.viewport;
  const askedY = !!vpIn && typeof vpIn === 'object' && (vpIn.ymin !== undefined || vpIn.ymax !== undefined);
  const aspect = askedY ? aspectWarning(v.spec) : null;
  return {
    ok: errors.length === 0,
    errors,
    warnings: [...v.warnings, ...(aspect ? [aspect] : []), ...sem.warnings],
    expressions: sem.expressions,
    spec: v.spec,
  };
}
