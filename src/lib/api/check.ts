import { parseEntry, type Parsed } from '../math/parse';
import { computeAll, type CurveResult } from '../compute';
import type { GraphData } from '../graphFile';
import type { Viewport } from '../../store/types';
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
    case 'points':
      return p.polyline
        ? `polyline through ${p.points.length} points`
        : `${p.points.length} point${p.points.length === 1 ? '' : 's'}`;
    case 'pointvar':
      return `point ${p.name}`;
    case 'empty':
      return 'empty';
    case 'error':
      return `error: ${p.message}`;
  }
}

/** Does any part of the result fall inside the viewport? */
function anyVisible(r: CurveResult, vp: Viewport): boolean {
  const inside = (t: number, y: number) => t >= vp.tMin && t <= vp.tMax && y >= vp.yMin && y <= vp.yMax;
  if (r.points?.some(([t, y]) => inside(t, y))) return true;
  for (const seg of r.curve.segments) for (const [t, y] of seg) if (inside(t, y)) return true;
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
        message: `unknown function ${res.unknownFns.join(', ')} in "${entry.raw}" (user-defined functions like f(x) = … are not supported; write y = … instead)`,
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
    const isPolar = parsed.kind === 'polar' || (parsed.kind === 'inequality' && parsed.polar);
    const isPoint = parsed.kind === 'points' || parsed.kind === 'pointvar';
    const misplaced: [boolean, string, string][] = [
      [entry.t0 !== undefined || entry.ic !== undefined, 't0/ic', 'ODEs'],
      [
        entry.varMin !== undefined || entry.varMax !== undefined || entry.varStep !== undefined,
        'min/max/step',
        'sliders (k = 2)',
      ],
      [entry.thetaMin !== undefined || entry.thetaMax !== undefined, 'thetaMin/thetaMax', 'polar curves/regions'],
      [
        entry.pointLabel !== undefined || entry.pointSize !== undefined || entry.pointDrag !== undefined || entry.pointLabelDir !== undefined,
        'label/labelDir/pointSize/drag',
        'points',
      ],
    ];
    const applies: Record<string, boolean> = {
      't0/ic': parsed.kind === 'ode',
      'min/max/step': parsed.kind === 'variable',
      'thetaMin/thetaMax': isPolar,
      'label/labelDir/pointSize/drag': isPoint,
    };
    for (const [present, what, forWhat] of misplaced) {
      if (present && !applies[what]) {
        warnings.push({ path, message: `${what} only apply to ${forWhat}; ignored for this ${parsed.kind} expression` });
      }
    }
    if (parsed.kind === 'ode' && entry.ic && entry.ic.length > parsed.order) {
      warnings.push({
        path: `${path}.ic`,
        message: `"${entry.raw}" is ${ord(parsed.order)} order, so ic takes ${parsed.order} value${parsed.order > 1 ? 's' : ''} [${['y(t0)', "y'(t0)", "y''(t0)"].slice(0, parsed.order).join(', ')}…]; extra values ignored`,
      });
    }
    if (parsed.kind === 'variable') {
      const v = entry.varValue ?? parsed.value;
      if ((entry.varMin !== undefined && v < entry.varMin) || (entry.varMax !== undefined && v > entry.varMax)) {
        warnings.push({ path, message: `slider value ${v} is outside [min, max]` });
      }
    }

    const plottable = !['empty', 'variable', 'error'].includes(parsed.kind);
    if (plottable && res && !res.error && !res.undefinedVars?.length && entry.visible) {
      rep.visible = anyVisible(res, vp);
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
  const shown = ((tMax - tMin) * TYPICAL_ASPECT).toPrecision(2);
  const c = ((yMin + yMax) / 2).toPrecision(3);
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
  const aspect = aspectWarning(v.spec);
  return {
    ok: errors.length === 0,
    errors,
    warnings: [...v.warnings, ...(aspect ? [aspect] : []), ...sem.warnings],
    expressions: sem.expressions,
    spec: v.spec,
  };
}
