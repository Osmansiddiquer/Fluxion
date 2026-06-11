import { useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import { useStore } from '../../store/useStore';
import { useAnalysis } from '../../state/results';
import { makeTransform, correctAspect, type Transform } from '../../lib/geom/transform';
import { evalCurveAt } from '../../lib/analysis/eval';
import { formatPointsRaw } from '../../lib/math/points';
import { fmtSig } from '../../lib/format';
import type { Viewport, FeatureToggles } from '../../store/types';
import type { Feature, FeatureKind } from '../../lib/analysis/types';
import { FEATURE_LABEL } from '../../lib/analysis/types';
import { drawGrid, readGridColors } from './grid';
import { drawMarkers, colorForMarker, type PlacedMarker } from './markers';
import FeatureToggle from './FeatureToggle';
import './PlotCanvas.css';

interface Size {
  w: number;
  h: number;
}

const KIND_TOGGLE: Record<FeatureKind, keyof FeatureToggles> = {
  max: 'extrema',
  min: 'extrema',
  root: 'xIntercepts',
  yIntercept: 'yIntercept',
  endpoint: 'endpoints',
  discontinuity: 'discontinuities',
  intersection: 'intersections',
};

const HOVER_PX = 10;
const SNAP_PX = 13;
const GRAB_PX = 13;

function fmt(n: number): string {
  return fmtSig(n);
}

/** Nearest point (in screen px) on any segment of a curve to the cursor. */
function nearestPointOnCurve(
  curve: { segments: [number, number][][] },
  mx: number,
  my: number,
  tf: Transform,
): { t: number; y: number; d: number } | null {
  let best: { t: number; y: number; d: number } | null = null;
  for (const seg of curve.segments) {
    for (let i = 0; i < seg.length - 1; i++) {
      const ax = tf.tx(seg[i][0]);
      const ay = tf.ty(seg[i][1]);
      const bx = tf.tx(seg[i + 1][0]);
      const by = tf.ty(seg[i + 1][1]);
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let u = len2 > 0 ? ((mx - ax) * dx + (my - ay) * dy) / len2 : 0;
      u = Math.max(0, Math.min(1, u));
      const d = Math.hypot(ax + u * dx - mx, ay + u * dy - my);
      if (!best || d < best.d) {
        best = {
          t: seg[i][0] + u * (seg[i + 1][0] - seg[i][0]),
          y: seg[i][1] + u * (seg[i + 1][1] - seg[i][1]),
          d,
        };
      }
    }
  }
  return best;
}

const LABEL_GAP = 10;
const DIR_MAP: Record<string, { tx: string; ty: string; dx: number; dy: number }> = {
  n: { tx: '-50%', ty: '-100%', dx: 0, dy: -LABEL_GAP },
  ne: { tx: '0', ty: '-100%', dx: LABEL_GAP, dy: -LABEL_GAP },
  e: { tx: '0', ty: '-50%', dx: LABEL_GAP, dy: 0 },
  se: { tx: '0', ty: '0', dx: LABEL_GAP, dy: LABEL_GAP },
  s: { tx: '-50%', ty: '0', dx: 0, dy: LABEL_GAP },
  sw: { tx: '-100%', ty: '0', dx: -LABEL_GAP, dy: LABEL_GAP },
  w: { tx: '-100%', ty: '-50%', dx: -LABEL_GAP, dy: 0 },
  nw: { tx: '-100%', ty: '-100%', dx: -LABEL_GAP, dy: -LABEL_GAP },
};

function dirStyle(dir: string, x: number, y: number): React.CSSProperties {
  const m = DIR_MAP[dir] ?? DIR_MAP.ne;
  return { left: x + m.dx, top: y + m.dy, transform: `translate(${m.tx}, ${m.ty})` };
}

interface Tip {
  px: number;
  py: number;
  color: string;
  title?: string;
  t: number;
  y: number;
}

interface Pin {
  entryId: string;
  t: number;
  y: number;
  label?: string;
}

export default function PlotCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [tip, setTip] = useState<Tip | null>(null);
  const [pin, setPin] = useState<Pin | null>(null);

  const entries = useStore((s) => s.entries);
  const viewport = useStore((s) => s.viewport);
  const setViewport = useStore((s) => s.setViewport);
  const updateEntry = useStore((s) => s.updateEntry);
  const toggles = useStore((s) => s.features);
  const projections = useStore((s) => s.projections);
  const setProjections = useStore((s) => s.setProjections);
  const theme = useStore((s) => s.theme);
  const sigFigs = useStore((s) => s.sigFigs);
  const analysis = useAnalysis();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((obs) => {
      const r = obs[0].contentRect;
      setSize({ w: Math.max(1, r.width), h: Math.max(1, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep a square grid (equal aspect) so circles stay round. Corrects the y-range
  // to match the t-range whenever the viewport or canvas size changes.
  useEffect(() => {
    if (size.w < 2 || size.h < 2) return;
    const desiredYSpan = (viewport.tMax - viewport.tMin) * (size.h / size.w);
    const curYSpan = viewport.yMax - viewport.yMin;
    if (Math.abs(curYSpan - desiredYSpan) > Math.abs(desiredYSpan) * 1e-3 + 1e-9) {
      setViewport(correctAspect(viewport, size.w, size.h));
    }
  }, [viewport, size, setViewport]);

  // Single-valued curves (function / ode) eligible for tracing.
  const traceable = useMemo(
    () =>
      entries
        .filter((e) => e.visible)
        .map((e) => ({ entry: e, res: analysis.results.get(e.id) }))
        .filter(
          (x) =>
            x.res &&
            (x.res.parsed.kind === 'function' || x.res.parsed.kind === 'ode') &&
            x.res.curve.segments.length > 0,
        ),
    [entries, analysis],
  );

  // Implicit curves can be traced too, but by nearest-point (they're multi-valued).
  const traceableImplicit = useMemo(
    () =>
      entries
        .filter((e) => e.visible)
        .map((e) => ({ entry: e, res: analysis.results.get(e.id) }))
        .filter(
          (x) =>
            x.res &&
            (x.res.parsed.kind === 'implicit' || x.res.parsed.kind === 'polar') &&
            x.res.curve.segments.length > 0,
        ),
    [entries, analysis],
  );

  const markers = useMemo<PlacedMarker[]>(() => {
    const list: PlacedMarker[] = [];
    for (const entry of entries) {
      if (!entry.visible) continue;
      const feats = analysis.features.get(entry.id);
      if (!feats) continue;
      for (const f of feats) if (toggles[KIND_TOGGLE[f.kind]]) list.push({ f, color: entry.color });
    }
    if (toggles.intersections) for (const f of analysis.intersections) list.push({ f, color: '' });
    return list;
  }, [entries, analysis, toggles]);

  // variable name -> entry id, so dragging a point can update its variables.
  const varEntry = useMemo(() => {
    const m = new Map<string, string>();
    for (const entry of entries) {
      const res = analysis.results.get(entry.id);
      if (res?.parsed.kind === 'variable') m.set(res.parsed.name, entry.id);
    }
    return m;
  }, [entries, analysis]);

  // Plotted point markers. A coordinate is draggable only when it's a variable;
  // the mode (x / y / free) follows from which coordinates are variables.
  type DragMode = 'none' | 'x' | 'y' | 'free';
  const pointMarkers = useMemo(() => {
    const list: {
      entryId: string;
      index: number;
      coord: [number, number];
      color: string;
      size: number;
      mode: DragMode;
      xVar?: string;
      yVar?: string;
      xRaw: boolean;
      yRaw: boolean;
    }[] = [];
    for (const entry of entries) {
      if (!entry.visible) continue;
      const res = analysis.results.get(entry.id);
      if (!res?.points) continue;
      if (res.parsed.kind !== 'points' && res.parsed.kind !== 'pointvar') continue;
      const setting = entry.pointDrag ?? 'auto';
      const size = entry.pointSize ?? 6;
      res.points.forEach((coord, index) => {
        let xSym: string | undefined;
        let ySym: string | undefined;
        let literal = false;
        if (res.parsed.kind === 'points') {
          const spec = res.parsed.points[index];
          xSym = spec?.xSym;
          ySym = spec?.ySym;
          literal = spec?.literal ?? false;
        } else if (res.parsed.kind === 'pointvar') {
          xSym = res.parsed.xSym;
          ySym = res.parsed.ySym;
          literal = res.parsed.literal;
        }
        const xIsVar = !!(xSym && varEntry.has(xSym));
        const yIsVar = !!(ySym && varEntry.has(ySym));
        const wantX = setting === 'x' || setting === 'both' || (setting === 'auto' && xIsVar);
        const wantY = setting === 'y' || setting === 'both' || (setting === 'auto' && yIsVar);
        let xVar: string | undefined;
        let yVar: string | undefined;
        let xRaw = false;
        let yRaw = false;
        if (setting !== 'off') {
          // A variable coordinate drags the variable; a literal one rewrites the raw
          // (only safe when the whole point is literal, so vars aren't lost).
          if (wantX) xIsVar ? (xVar = xSym) : literal && (xRaw = true);
          if (wantY) yIsVar ? (yVar = ySym) : literal && (yRaw = true);
        }
        const xDrag = !!xVar || xRaw;
        const yDrag = !!yVar || yRaw;
        const mode: DragMode = xDrag && yDrag ? 'free' : xDrag ? 'x' : yDrag ? 'y' : 'none';
        list.push({ entryId: entry.id, index, coord, color: entry.color, size, mode, xVar, yVar, xRaw, yRaw });
      });
    }
    return list;
  }, [entries, analysis, varEntry]);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 2) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const tf = makeTransform(viewport, size.w, size.h);
    drawGrid(ctx, tf, readGridColors());

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const entry of entries) {
      const res = analysis.results.get(entry.id);
      if (!res || !entry.visible) continue;
      ctx.strokeStyle = entry.color;
      ctx.lineWidth = 2.25;
      for (const seg of res.curve.segments) {
        ctx.beginPath();
        for (let i = 0; i < seg.length; i++) {
          const px = tf.tx(seg[i][0]);
          const py = tf.ty(seg[i][1]);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }

    drawMarkers(ctx, tf, markers);

    // Plotted points. Look reflects drag mode: free = haloed dot with 4-way ticks,
    // x/y = directional arrows, static (literal) = plain small dot.
    {
      const ring = readGridColors().bg;
      for (const pm of pointMarkers) {
        const x = tf.tx(pm.coord[0]);
        const y = tf.ty(pm.coord[1]);
        if (x < -12 || x > size.w + 12 || y < -12 || y > size.h + 12) continue;
        const drag = pm.mode !== 'none';
        const r = pm.size;
        if (drag) {
          // soft halo so draggable points feel grabbable
          ctx.beginPath();
          ctx.arc(x, y, r + 4, 0, Math.PI * 2);
          ctx.fillStyle = pm.color;
          ctx.globalAlpha = 0.14;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = pm.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = ring;
        ctx.stroke();
        // Directional arrows.
        ctx.strokeStyle = pm.color;
        ctx.lineWidth = 1.5;
        const a = r + 6;
        const chev = (dx: number, dy: number) => {
          const tipX = x + dx * a;
          const tipY = y + dy * a;
          ctx.beginPath();
          ctx.moveTo(tipX - dy * 3 - dx * 3, tipY + dx * 3 - dy * 3);
          ctx.lineTo(tipX, tipY);
          ctx.lineTo(tipX + dy * 3 - dx * 3, tipY - dx * 3 - dy * 3);
          ctx.stroke();
        };
        if (pm.mode === 'x' || pm.mode === 'free') {
          chev(-1, 0);
          chev(1, 0);
        }
        if (pm.mode === 'y' || pm.mode === 'free') {
          chev(0, -1);
          chev(0, 1);
        }
      }
    }

    // Pinned trace point.
    if (pin) {
      const color = entries.find((e) => e.id === pin.entryId)?.color ?? '#000';
      const x = tf.tx(pin.t);
      const y = tf.ty(pin.y);
      const ring = readGridColors().bg;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = ring;
      ctx.stroke();
    }

    // Projection cursors.
    const { rightOpen, bottomOpen, sliceT, sliceY } = projections;
    if (rightOpen || bottomOpen) {
      const cursor =
        getComputedStyle(document.documentElement).getPropertyValue('--cursor').trim() ||
        '#f0a000';
      ctx.strokeStyle = cursor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      // Right panel samples the vertical cut t = sliceT; bottom panel the
      // horizontal cut y = sliceY. Each cursor belongs to its own panel.
      if (rightOpen) {
        const x = Math.round(tf.tx(sliceT)) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size.h);
      }
      if (bottomOpen) {
        const y = Math.round(tf.ty(sliceY)) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(size.w, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Grab handles so it reads as draggable: a grip tab at the top of the
      // vertical cut and the left of the horizontal cut.
      const grip = (cx: number, cy: number, horizontal: boolean) => {
        ctx.fillStyle = cursor;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(cx - 9, cy - 8, 18, 16, 5);
        ctx.fill();
        ctx.stroke();
        // two grip lines
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        if (horizontal) {
          ctx.moveTo(cx - 4, cy - 3);
          ctx.lineTo(cx + 4, cy - 3);
          ctx.moveTo(cx - 4, cy + 3);
          ctx.lineTo(cx + 4, cy + 3);
        } else {
          ctx.moveTo(cx - 3, cy - 4);
          ctx.lineTo(cx - 3, cy + 4);
          ctx.moveTo(cx + 3, cy - 4);
          ctx.lineTo(cx + 3, cy + 4);
        }
        ctx.stroke();
      };
      if (rightOpen) grip(tf.tx(sliceT), 10, false);
      if (bottomOpen) grip(size.w - 11, tf.ty(sliceY), true);
    }
  }, [analysis, viewport, size, entries, markers, pointMarkers, projections, pin, theme, sigFigs]);

  // --- Interaction ---------------------------------------------------------
  const interaction = useRef<
    | { type: 'pan'; x: number; y: number; vp: Viewport }
    | { type: 'trace'; entryId: string }
    | {
        type: 'point';
        entryId: string;
        index: number;
        xVar?: string;
        yVar?: string;
        xRaw: boolean;
        yRaw: boolean;
      }
    | { type: 'cursorT' }
    | { type: 'cursorY' }
    | null
  >(null);

  // Throttle viewport updates to one per animation frame so a fast pan/zoom can't
  // trigger heavy re-solving (integration, marching squares) faster than we draw.
  const rafId = useRef<number | null>(null);
  const pendingVp = useRef<Viewport | null>(null);
  const commitViewport = (vp: Viewport) => {
    pendingVp.current = vp;
    if (rafId.current == null) {
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        if (pendingVp.current) setViewport(pendingVp.current);
      });
    }
  };
  useEffect(
    () => () => {
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
    },
    [],
  );

  const evalEntry = (entryId: string, t: number): number | null => {
    const res = analysis.results.get(entryId);
    return res ? evalCurveAt(res.curve, t) : null;
  };

  const nearestCurve = (mx: number, my: number, tf: Transform) => {
    const cursorT = tf.ix(mx);
    let best: { entryId: string; color: string; t: number; y: number } | null = null;
    let bestD = HOVER_PX;
    for (const { entry, res } of traceable) {
      const v = evalCurveAt(res!.curve, cursorT);
      if (v == null) continue;
      const d = Math.abs(tf.ty(v) - my);
      if (d < bestD) {
        bestD = d;
        best = { entryId: entry.id, color: entry.color, t: cursorT, y: v };
      }
    }
    for (const { entry, res } of traceableImplicit) {
      const np = nearestPointOnCurve(res!.curve, mx, my, tf);
      if (np && np.d < bestD) {
        bestD = np.d;
        best = { entryId: entry.id, color: entry.color, t: np.t, y: np.y };
      }
    }
    return best;
  };

  // Snap a trace to a nearby feature of its own curve, else follow the cursor t.
  const snapTrace = (entryId: string, mx: number, my: number, tf: Transform): Pin | null => {
    const cursorT = tf.ix(mx);
    let snap: { t: number; y: number; label: string } | null = null;
    let bestD = SNAP_PX;
    const consider = (f: Feature) => {
      const d = Math.hypot(tf.tx(f.t) - mx, tf.ty(f.y) - my);
      if (d < bestD) {
        bestD = d;
        snap = { t: f.t, y: f.y, label: FEATURE_LABEL[f.kind] };
      }
    };
    (analysis.features.get(entryId) ?? []).forEach(consider);
    for (const f of analysis.intersections) {
      if (f.aId === entryId || f.bId === entryId) consider(f);
    }
    if (snap) return { entryId, ...(snap as { t: number; y: number; label: string }) };
    // Implicit/polar curves are multi-valued: trace the nearest point on the curve.
    const res = analysis.results.get(entryId);
    if (res?.parsed.kind === 'implicit' || res?.parsed.kind === 'polar') {
      const np = nearestPointOnCurve(res.curve, mx, my, tf);
      if (np) return { entryId, t: np.t, y: np.y };
      return pin && pin.entryId === entryId ? pin : null;
    }
    const v = evalEntry(entryId, cursorT);
    if (v == null) return pin && pin.entryId === entryId ? pin : null;
    return { entryId, t: cursorT, y: v };
  };

  const tipFor = (p: Pin, tf: Transform): Tip => ({
    px: tf.tx(p.t),
    py: tf.ty(p.y),
    color: entries.find((e) => e.id === p.entryId)?.color ?? '#000',
    title: p.label,
    t: p.t,
    y: p.y,
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (size.w < 2) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const tf = makeTransform(viewport, size.w, size.h);

    // Grab a draggable plotted point (only when a coordinate is a variable)?
    for (const pm of pointMarkers) {
      if (pm.mode === 'none') continue;
      const d = Math.hypot(tf.tx(pm.coord[0]) - mx, tf.ty(pm.coord[1]) - my);
      if (d < GRAB_PX) {
        interaction.current = {
          type: 'point',
          entryId: pm.entryId,
          index: pm.index,
          xVar: pm.xVar,
          yVar: pm.yVar,
          xRaw: pm.xRaw,
          yRaw: pm.yRaw,
        };
        return;
      }
    }
    // Grab an existing pin?
    if (pin) {
      const d = Math.hypot(tf.tx(pin.t) - mx, tf.ty(pin.y) - my);
      if (d < GRAB_PX) {
        interaction.current = { type: 'trace', entryId: pin.entryId };
        return;
      }
    }
    // Click on a curve -> pin + trace.
    const near = nearestCurve(mx, my, tf);
    if (near) {
      const next = snapTrace(near.entryId, mx, my, tf) ?? near;
      setPin(next);
      setTip(tipFor(next, tf));
      interaction.current = { type: 'trace', entryId: near.entryId };
      return;
    }
    // Grab a projection cut line (drag the dashed cursor directly on the plot).
    const { rightOpen, bottomOpen, sliceT, sliceY } = projections;
    if (rightOpen && Math.abs(tf.tx(sliceT) - mx) < GRAB_PX) {
      interaction.current = { type: 'cursorT' };
      setProjections({ sliceT: tf.ix(mx), sliceTExpr: undefined });
      return;
    }
    if (bottomOpen && Math.abs(tf.ty(sliceY) - my) < GRAB_PX) {
      interaction.current = { type: 'cursorY' };
      setProjections({ sliceY: tf.iy(my), sliceYExpr: undefined });
      return;
    }
    // Empty space -> clear pin and pan.
    setPin(null);
    setTip(null);
    interaction.current = { type: 'pan', x: e.clientX, y: e.clientY, vp: viewport };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (size.w < 2) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const tf = makeTransform(viewport, size.w, size.h);
    const it = interaction.current;

    if (it?.type === 'point') {
      const nt = tf.ix(mx);
      const ny = tf.iy(my);
      if (it.xVar) {
        const id = varEntry.get(it.xVar);
        if (id) updateEntry(id, { varValue: nt });
      }
      if (it.yVar) {
        const id = varEntry.get(it.yVar);
        if (id) updateEntry(id, { varValue: ny });
      }
      const pm = pointMarkers.find((m) => m.entryId === it.entryId && m.index === it.index);
      if (it.xRaw || it.yRaw) {
        // Literal coordinate(s) dragged: rewrite them in the raw text.
        const res = analysis.results.get(it.entryId);
        const cur = res?.points?.[it.index] ?? [nt, ny];
        const newX = it.xRaw ? nt : cur[0];
        const newY = it.yRaw ? ny : cur[1];
        const round = (n: number) => fmtSig(n);
        if (res?.parsed.kind === 'pointvar') {
          updateEntry(it.entryId, { raw: `${res.parsed.name} = (${round(newX)}, ${round(newY)})` });
        } else if (res?.parsed.kind === 'points' && res.points) {
          const next = res.points.map((c, i): [number, number] => (i === it.index ? [newX, newY] : c));
          updateEntry(it.entryId, {
            raw: formatPointsRaw(next, res.parsed.polyline, res.parsed.scattered),
          });
        }
      }
      const dispT = it.xVar || it.xRaw ? nt : pm?.coord[0] ?? nt;
      const dispY = it.yVar || it.yRaw ? ny : pm?.coord[1] ?? ny;
      const color = entries.find((e) => e.id === it.entryId)?.color ?? '#000';
      setTip({ px: tf.tx(dispT), py: tf.ty(dispY), color, t: dispT, y: dispY });
      return;
    }

    if (it?.type === 'cursorT') {
      setProjections({ sliceT: tf.ix(mx), sliceTExpr: undefined });
      return;
    }
    if (it?.type === 'cursorY') {
      setProjections({ sliceY: tf.iy(my), sliceYExpr: undefined });
      return;
    }

    if (it?.type === 'trace') {
      const next = snapTrace(it.entryId, mx, my, tf);
      if (next) {
        setPin(next);
        setTip(tipFor(next, tf));
      }
      return;
    }
    if (it?.type === 'pan') {
      const tSpan = it.vp.tMax - it.vp.tMin;
      const ySpan = it.vp.yMax - it.vp.yMin;
      const dt = ((e.clientX - it.x) / size.w) * tSpan;
      const dy = ((e.clientY - it.y) / size.h) * ySpan;
      commitViewport({
        tMin: it.vp.tMin - dt,
        tMax: it.vp.tMax - dt,
        yMin: it.vp.yMin + dy,
        yMax: it.vp.yMax + dy,
      });
      return;
    }

    // Hover (no button): show a resize cursor over a draggable cut line.
    const { rightOpen, bottomOpen, sliceT, sliceY } = projections;
    const canvasEl = canvasRef.current;
    if (canvasEl) {
      if (rightOpen && Math.abs(tf.tx(sliceT) - mx) < GRAB_PX) canvasEl.style.cursor = 'ew-resize';
      else if (bottomOpen && Math.abs(tf.ty(sliceY) - my) < GRAB_PX) canvasEl.style.cursor = 'ns-resize';
      else canvasEl.style.cursor = '';
    }

    // Hover (no button): points first, then feature markers, then curve.
    let best: Tip | null = null;
    let bestD = 11;
    for (const pm of pointMarkers) {
      const d = Math.hypot(tf.tx(pm.coord[0]) - mx, tf.ty(pm.coord[1]) - my);
      if (d < bestD) {
        bestD = d;
        best = {
          px: tf.tx(pm.coord[0]),
          py: tf.ty(pm.coord[1]),
          color: pm.color,
          t: pm.coord[0],
          y: pm.coord[1],
        };
      }
    }
    for (const m of markers) {
      const d = Math.hypot(tf.tx(m.f.t) - mx, tf.ty(m.f.y) - my);
      if (d < bestD) {
        bestD = d;
        best = {
          px: tf.tx(m.f.t),
          py: tf.ty(m.f.y),
          color: colorForMarker(m),
          title: FEATURE_LABEL[m.f.kind],
          t: m.f.t,
          y: m.f.y,
        };
      }
    }
    if (!best) {
      const near = nearestCurve(mx, my, tf);
      if (near) best = { px: tf.tx(near.t), py: tf.ty(near.y), color: near.color, t: near.t, y: near.y };
    }
    if (pin) {
      // Keep showing the pin tooltip unless hovering a labelled feature.
      setTip(best && best.title ? best : tipFor(pin, tf));
    } else {
      setTip(best);
    }
  };

  const endInteraction = (e: React.PointerEvent) => {
    interaction.current = null;
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (size.w < 2) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    // Compound zoom off the pending viewport so fast scrolls don't get dropped.
    const base = pendingVp.current ?? viewport;
    const tf = makeTransform(base, size.w, size.h);
    const ct = tf.ix(px);
    const cy = tf.iy(py);
    const factor = Math.exp(e.deltaY * 0.0015);
    const newTSpan = Math.min(1e7, Math.max(1e-6, (base.tMax - base.tMin) * factor));
    // Equal aspect: derive the y-span from the t-span and the pixel ratio.
    const newYSpan = newTSpan * (size.h / size.w);
    const ftx = px / size.w;
    const fty = (size.h - py) / size.h;
    commitViewport({
      tMin: ct - ftx * newTSpan,
      tMax: ct + (1 - ftx) * newTSpan,
      yMin: cy - fty * newYSpan,
      yMax: cy + (1 - fty) * newYSpan,
    });
  };

  // Point labels (rendered as positioned KaTeX overlays).
  const labels: { key: string; html: string; x: number; y: number; dir: string; color: string }[] = [];
  if (size.w > 1) {
    const tf = makeTransform(viewport, size.w, size.h);
    for (const entry of entries) {
      if (!entry.visible || !entry.pointLabel?.trim()) continue;
      const res = analysis.results.get(entry.id);
      if (!res?.points) continue;
      // Labels are for single points only — not arrays or polylines.
      if (res.parsed.kind === 'points' && (res.parsed.polyline || res.parsed.points.length !== 1)) {
        continue;
      }
      if (res.parsed.kind !== 'points' && res.parsed.kind !== 'pointvar') continue;
      let html = '';
      try {
        html = katex.renderToString(entry.pointLabel, { throwOnError: false });
      } catch {
        html = '';
      }
      if (!html) continue;
      res.points.forEach((coord, i) => {
        labels.push({
          key: `${entry.id}-${i}`,
          html,
          x: tf.tx(coord[0]),
          y: tf.ty(coord[1]),
          dir: entry.pointLabelDir ?? 'ne',
          color: entry.color,
        });
      });
    }
  }

  return (
    <div className="plot" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="plot-canvas"
        style={{ width: size.w, height: size.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
        onPointerLeave={() => !interaction.current && setTip(pin ? tip : null)}
        onWheel={onWheel}
      />
      <FeatureToggle />
      {tip && (
        <div className="plot-tooltip" style={{ left: tip.px, top: tip.py }} role="status">
          <span className="tt-dot" style={{ background: tip.color }} />
          {tip.title && <span className="tt-kind">{tip.title}</span>}
          <span className="tt-coords">
            ({fmt(tip.t)}, {fmt(tip.y)})
          </span>
        </div>
      )}
      {labels.map((l) => (
        <div
          key={l.key}
          className="point-label"
          style={{ ...dirStyle(l.dir, l.x, l.y), color: l.color }}
          dangerouslySetInnerHTML={{ __html: l.html }}
        />
      ))}
    </div>
  );
}
