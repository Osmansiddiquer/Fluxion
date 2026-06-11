import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useResults, useSliceStatus } from '../../state/results';
import { useElementSize } from '../../hooks/useElementSize';
import { verticalCrossings, yExtent } from '../../lib/analysis/eval';
import { niceTicks, formatTick } from '../../lib/geom/transform';
import { readGridColors } from '../Plot/grid';
import SliceInput from './SliceInput';
import { fmtSig } from '../../lib/format';
import './Projections.css';

function fmt(n: number): string {
  return fmtSig(n);
}

const MAX_VISIBLE = 5;

/**
 * Right projection panel (vertical y-slice). Every plottable curve is shown the
 * same way: a faint line spanning its y-extent, with a dot at each y where it
 * crosses the vertical cut t = sliceT (drag that cut on the main plot, or type t
 * in the header). At most five cross-sections fit at once; scroll for the rest.
 */
export default function RightPanel() {
  const projections = useStore((s) => s.projections);
  const setProjections = useStore((s) => s.setProjections);
  const viewport = useStore((s) => s.viewport);
  const entries = useStore((s) => s.entries);
  const theme = useStore((s) => s.theme);
  const sigFigs = useStore((s) => s.sigFigs);
  const panelW = useStore((s) => s.panelW);
  const setPanelW = useStore((s) => s.setPanelW);
  const results = useResults();
  const sliceStatus = useSliceStatus();
  const [setRef, size, canvasRef] = useElementSize<HTMLCanvasElement>();
  const [scroll, setScroll] = useState(0);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelW;
    const move = (ev: PointerEvent) => setPanelW(startW + (startX - ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const { rightOpen, sliceT, sliceTExpr } = projections;
  const ySpan = viewport.yMax - viewport.yMin || 1;
  const ty = (y: number) => size.h - ((y - viewport.yMin) / ySpan) * size.h;

  const proj = useMemo(
    () =>
      entries
        .filter((e) => e.visible)
        .map((e) => ({ entry: e, res: results.get(e.id) }))
        .filter(
          (x) =>
            x.res &&
            x.res.curve.segments.length > 0 &&
            (x.res.parsed.kind === 'function' ||
              x.res.parsed.kind === 'ode' ||
              x.res.parsed.kind === 'implicit' ||
              x.res.parsed.kind === 'polar' ||
              x.res.parsed.kind === 'inequality'),
        ),
    [entries, results],
  );

  const labelW = 30;
  const x0 = labelW + 16;
  const x1 = Math.max(x0 + 1, size.w - 14);
  const usable = Math.max(1, x1 - x0);
  const slotW = usable / Math.min(Math.max(proj.length, 1), MAX_VISIBLE);
  const maxScroll = Math.max(0, proj.length * slotW - usable);
  const sc = Math.max(0, Math.min(maxScroll, scroll));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rightOpen || size.w < 2) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = readGridColors();

    ctx.fillStyle = c.panelBg;
    ctx.fillRect(0, 0, size.w, size.h);

    const ticks = niceTicks(viewport.yMin, viewport.yMax, Math.max(2, Math.round(size.h / 60)));

    // 1D grid: faint minor lines, stronger major lines, a bolder line at y = 0.
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.minor;
    ctx.beginPath();
    const minorStep = ticks.step / 5;
    for (let y = Math.ceil(viewport.yMin / minorStep) * minorStep, i = 0;
         y <= viewport.yMax && i < 5000; y += minorStep, i++) {
      const py = Math.round(ty(y)) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(size.w, py);
    }
    ctx.stroke();
    ctx.strokeStyle = c.major;
    ctx.beginPath();
    for (const y of ticks.values) {
      const py = Math.round(ty(y)) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(size.w, py);
    }
    ctx.stroke();
    if (viewport.yMin <= 0 && viewport.yMax >= 0) {
      ctx.strokeStyle = c.axis;
      ctx.lineWidth = 1.5;
      const py = Math.round(ty(0)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(size.w, py);
      ctx.stroke();
    }

    // y tick labels.
    ctx.fillStyle = c.axisText;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const y of ticks.values) {
      const py = Math.round(ty(y)) + 0.5;
      ctx.fillText(formatTick(y, ticks.step), 4, py);
    }

    // Per-curve y-projection columns (at most MAX_VISIBLE visible; scroll for more).
    const ring = c.panelBg;
    proj.forEach(({ entry, res }, i) => {
      const cx = x0 + (i + 0.5) * slotW - sc;
      if (cx < x0 - slotW || cx > x1 + slotW) return; // scrolled out of view
      const ext = yExtent(res!.curve, viewport.tMin, viewport.tMax);
      if (ext) {
        ctx.strokeStyle = entry.color;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, ty(ext[1]));
        ctx.lineTo(cx, ty(ext[0]));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      for (const yv of verticalCrossings(res!.curve, sliceT)) {
        const py = ty(yv);
        ctx.beginPath();
        ctx.arc(cx, py, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = entry.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = ring;
        ctx.stroke();
        ctx.fillStyle = c.axisText;
        ctx.textAlign = 'left';
        ctx.fillText(fmt(yv), cx + 8, py);
      }
    });
  }, [canvasRef, rightOpen, size, viewport, proj, sliceT, theme, sigFigs, sc, slotW, x0, x1]);

  if (!rightOpen) {
    return (
      <button
        className="panel-reopen panel-reopen-right"
        title="Show y-projection"
        onClick={() => setProjections({ rightOpen: true })}
      >
        ‹
      </button>
    );
  }

  return (
    <div className="proj-panel proj-right">
      <div className="panel-resize panel-resize-v" onPointerDown={startResize} />
      <div className="proj-head">
        <span className="proj-title">
          y at t ={' '}
          <SliceInput
            value={sliceT}
            expr={sliceTExpr}
            invalid={!sliceStatus.tValid}
            onCommit={(text) => {
              const t = text.trim();
              const num = Number(t);
              if (t !== '' && Number.isFinite(num)) setProjections({ sliceT: num, sliceTExpr: undefined });
              else if (t === '') setProjections({ sliceTExpr: undefined });
              else setProjections({ sliceTExpr: t });
            }}
          />
        </span>
        <button
          className="icon-btn"
          title="Collapse"
          onClick={() => setProjections({ rightOpen: false })}
        >
          ›
        </button>
      </div>
      <div className="proj-body">
        <canvas
          ref={setRef}
          className="proj-canvas"
          style={{ width: '100%', height: '100%', cursor: maxScroll > 0 ? 'ew-resize' : 'default' }}
          onWheel={(e) => {
            if (maxScroll <= 0) return;
            setScroll((s) => Math.max(0, Math.min(maxScroll, s + (e.deltaY || e.deltaX))));
          }}
        />
      </div>
    </div>
  );
}
