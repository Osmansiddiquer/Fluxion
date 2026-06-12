import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { computeAll, type CurveResult } from '../lib/compute';
import type { Entry } from '../store/types';
import { computeFeatures } from '../lib/analysis/features';
import { computeIntersections, curveIntersections } from '../lib/analysis/intersections';
import { detectSingularities } from '../lib/analysis/singularities';
import { buildVarScope, resolveSlice } from '../lib/math/resolveSlice';
import type { Feature } from '../lib/analysis/types';
import { useStore } from '../store/useStore';

export interface Analysis {
  results: Map<string, CurveResult>;
  /** Per-entry intrinsic features (extrema, roots, intercept, endpoints, …). */
  features: Map<string, Feature[]>;
  /** Intersections between visible curves (each tagged with both ids). */
  intersections: Feature[];
  /** Whether each panel's slice expression currently resolves (true if no expr). */
  sliceStatus: { tValid: boolean; yValid: boolean };
}

const EMPTY: Analysis = {
  results: new Map(),
  features: new Map(),
  intersections: [],
  sliceStatus: { tValid: true, yValid: true },
};
const AnalysisContext = createContext<Analysis>(EMPTY);

/**
 * A string capturing only the fields of `entries` that actually affect the
 * computed curves/features. Styling-and-UX-only edits (colour, expanded, point
 * size, label, animation, variable-slider bounds) leave this unchanged, so the
 * expensive recompute below is skipped entirely. Order is significant (ODE t0
 * ordering + intersection pairing), so we keep the entries in array order.
 */
function computeSignature(entries: Entry[]): string {
  let s = '';
  for (const e of entries) {
    s += `${e.id}${e.raw}${e.visible ? 1 : 0}${e.t0 ?? ''}${
      e.ic?.join(',') ?? ''
    }${e.varValue ?? ''}${e.thetaMin ?? ''}${e.thetaMax ?? ''}`;
  }
  return s;
}

/**
 * Computes every entry's curve and its inspection features once per
 * (entries, viewport) change, sharing the result with the plot and panels.
 */
export function ResultsProvider({ children }: { children: ReactNode }) {
  const entries = useStore((s) => s.entries);
  const viewport = useStore((s) => s.viewport);
  const panelW = useStore((s) => s.panelW);
  const panelH = useStore((s) => s.panelH);
  useEffect(() => {
    document.documentElement.style.setProperty('--panel-w', `${panelW}px`);
    document.documentElement.style.setProperty('--panel-h', `${panelH}px`);
  }, [panelW, panelH]);

  const [winW, setWinW] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1200,
  );
  useEffect(() => {
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const sampleCount = Math.min(4000, Math.max(800, Math.round(winW * 1.5)));
  const wantDiscontinuities = useStore((s) => s.features.discontinuities);

  // The memo below recomputes only when a compute-relevant input changes; it
  // reads the latest entries through a ref so a styling-only edit (which bumps
  // `entries`' identity but not the signature) is a true no-op.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const computeSig = useMemo(() => computeSignature(entries), [entries]);

  const analysis = useMemo<Omit<Analysis, 'sliceStatus'>>(() => {
    const entries = entriesRef.current;
    const results = computeAll(entries, viewport, sampleCount);
    const scope = buildVarScope(entries);

    const features = new Map<string, Feature[]>();
    // Curves eligible for intersection: single-valued (function/ode) get intrinsic
    // features too; implicit curves only participate in intersections.
    const curves: { id: string; single: boolean }[] = [];
    for (const entry of entries) {
      const res = results.get(entry.id);
      if (!res || !entry.visible) continue;
      if (res.curve.segments.length === 0) continue;
      if (res.parsed.kind === 'function' || res.parsed.kind === 'ode') {
        const feats = computeFeatures(res.curve, viewport);
        // Removable holes / undefined points (sin(t)/t at 0) need the symbolic
        // detector; only explicit functions have a node to analyse.
        if (wantDiscontinuities && res.parsed.kind === 'function') {
          feats.push(...detectSingularities(res.parsed.node, scope, viewport));
        }
        features.set(entry.id, feats);
        curves.push({ id: entry.id, single: true });
      } else if (res.parsed.kind === 'implicit' || res.parsed.kind === 'polar') {
        curves.push({ id: entry.id, single: false });
      }
    }

    const intersections: Feature[] = [];
    for (let i = 0; i < curves.length; i++) {
      for (let j = i + 1; j < curves.length; j++) {
        const a = results.get(curves[i].id)!.curve;
        const b = results.get(curves[j].id)!.curve;
        // The difference method is exact for two single-valued curves; otherwise
        // use the general segment-intersection (handles implicit/circles).
        const found =
          curves[i].single && curves[j].single
            ? computeIntersections(a, b, viewport)
            : curveIntersections(a, b, viewport);
        intersections.push(
          ...found.map((f) => ({ ...f, aId: curves[i].id, bId: curves[j].id })),
        );
      }
    }

    return { results, features, intersections };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computeSig, viewport, sampleCount, wantDiscontinuities]);

  // Resolve parametric slice expressions (e.g. sliceT = "k") against the variable
  // scope so the projection cuts can be driven by a slider / animation, and track
  // whether each expression is valid (undefined variable → invalid).
  const setProjections = useStore((s) => s.setProjections);
  const { sliceTExpr, sliceYExpr, sliceT, sliceY } = useStore((s) => s.projections);
  const sliceResolved = useMemo(() => {
    const scope = buildVarScope(entries);
    return {
      t: sliceTExpr ? resolveSlice(sliceTExpr, scope) : null,
      y: sliceYExpr ? resolveSlice(sliceYExpr, scope) : null,
    };
  }, [entries, sliceTExpr, sliceYExpr]);

  useEffect(() => {
    const upd: { sliceT?: number; sliceY?: number } = {};
    if (sliceResolved.t != null && sliceResolved.t !== sliceT) upd.sliceT = sliceResolved.t;
    if (sliceResolved.y != null && sliceResolved.y !== sliceY) upd.sliceY = sliceResolved.y;
    if (upd.sliceT !== undefined || upd.sliceY !== undefined) setProjections(upd);
  }, [sliceResolved, sliceT, sliceY, setProjections]);

  const value = useMemo<Analysis>(
    () => ({
      ...analysis,
      sliceStatus: {
        tValid: !sliceTExpr || sliceResolved.t != null,
        yValid: !sliceYExpr || sliceResolved.y != null,
      },
    }),
    [analysis, sliceTExpr, sliceYExpr, sliceResolved],
  );

  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}

export function useAnalysis(): Analysis {
  return useContext(AnalysisContext);
}

export function useResults(): Map<string, CurveResult> {
  return useContext(AnalysisContext).results;
}

export function useSliceStatus(): { tValid: boolean; yValid: boolean } {
  return useContext(AnalysisContext).sliceStatus;
}

export function useEntryResult(id: string): CurveResult | undefined {
  return useContext(AnalysisContext).results.get(id);
}
