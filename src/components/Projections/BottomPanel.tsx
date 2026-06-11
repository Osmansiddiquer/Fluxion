import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useResults, useSliceStatus } from '../../state/results';
import { useElementSize } from '../../hooks/useElementSize';
import { crossingsAt, curveExtent } from '../../lib/analysis/eval';
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
 * Bottom projection panel (horizontal t-slice). Every plottable curve is shown
 * the same way: a faint line spanning its t-extent, with a dot at each t where it
 * crosses the horizontal cut y = sliceY (drag that cut on the main plot, or type y
 * in the header). At most five cross-sections fit at once; scroll for the rest.
 */
export default function BottomPanel() {
  const projections = useStore((s) => s.projections);
  const setProjections = useStore((s) => s.setProjections);
  const viewport = useStore((s) => s.viewport);
  const entries = useStore((s) => s.entries);
  const theme = useStore((s) => s.theme);
  const sigFigs = useStore((s) => s.sigFigs);
  const panelH = useStore((s) => s.panelH);
  const setPanelH = useStore((s) => s.setPanelH);
  const results = useResults();
  const sliceStatus = useSliceStatus();
  const [setRef, size, canvasRef] = useElementSize<HTMLCanvasElement>();
  const [scroll, setScroll] = useState(0);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = panelH;
    const move = (ev: PointerEvent) => setPanelH(startH + (startY - ev.clientY));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const { bottomOpen, rightOpen, sliceY, sliceYExpr } = projections;
  const tSpan = viewport.tMax - viewport.tMin || 1;
  const tx = (t: number) => ((t - viewport.tMin) / tSpan) * size.w;

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

  const y0 = 14;
  const y1 = Math.max(y0 + 1, size.h - 18);
  const usable = Math.max(1, y1 - y0);
  const slotH = usable / Math.min(Math.max(proj.length, 1), MAX_VISIBLE);
  const maxScroll = Math.max(0, proj.length * slotH - usable);
  const sc = Math.max(0, Math.min(maxScroll, scroll));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bottomOpen || size.w < 2) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = readGridColors();

    ctx.fillStyle = c.panelBg;
    ctx.fillRect(0, 0, size.w, size.h);

    const ticks = niceTicks(viewport.tMin, viewport.tMax, Math.max(2, Math.round(size.w / 80)));

    // 1D grid: faint minor lines, stronger major lines, a bolder line at t = 0.
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.minor;
    ctx.beginPath();
    const minorStep = ticks.step / 5;
    for (let t = Math.ceil(viewport.tMin / minorStep) * minorStep, i = 0;
         t <= viewport.tMax && i < 5000; t += minorStep, i++) {
      const px = Math.round(tx(t)) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, size.h);
    }
    ctx.stroke();
    ctx.strokeStyle = c.major;
    ctx.beginPath();
    for (const t of ticks.values) {
      const px = Math.round(tx(t)) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, size.h);
    }
    ctx.stroke();
    if (viewport.tMin <= 0 && viewport.tMax >= 0) {
      ctx.strokeStyle = c.axis;
      ctx.lineWidth = 1.5;
      const px = Math.round(tx(0)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, size.h);
      ctx.stroke();
    }

    // t tick labels along the bottom.
    ctx.fillStyle = c.axisText;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const t of ticks.values) {
      const px = Math.round(tx(t)) + 0.5;
      ctx.fillText(formatTick(t, ticks.step), px, size.h - 4);
    }

    // Per-curve t-projection rows (at most MAX_VISIBLE visible; scroll for more).
    const ring = c.panelBg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    proj.forEach(({ entry, res }, i) => {
      const ry = y0 + (i + 0.5) * slotH - sc;
      if (ry < y0 - slotH || ry > y1 + slotH) return; // scrolled out of view
      const ext = curveExtent(res!.curve);
      if (ext) {
        ctx.strokeStyle = entry.color;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(tx(Math.max(ext[0], viewport.tMin)), ry);
        ctx.lineTo(tx(Math.min(ext[1], viewport.tMax)), ry);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      for (const t of crossingsAt(res!.curve, sliceY)) {
        if (t < viewport.tMin || t > viewport.tMax) continue;
        const px = tx(t);
        ctx.beginPath();
        ctx.arc(px, ry, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = entry.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = ring;
        ctx.stroke();
        ctx.fillStyle = c.axisText;
        ctx.fillText(fmt(t), px, ry - 8);
      }
    });
  }, [canvasRef, bottomOpen, size, viewport, proj, sliceY, theme, sigFigs, sc, slotH, y0, y1]);

  if (!bottomOpen) {
    return (
      <button
        className="panel-reopen panel-reopen-bottom"
        title="Show t-projection"
        onClick={() => setProjections({ bottomOpen: true })}
      >
        ⌃
      </button>
    );
  }

  return (
    <div className="proj-panel proj-bottom">
      <div className="panel-resize panel-resize-h" onPointerDown={startResize} />
      <div className="proj-head">
        <span className="proj-title">
          t where y ={' '}
          <SliceInput
            value={sliceY}
            expr={sliceYExpr}
            invalid={!sliceStatus.yValid}
            onCommit={(text) => {
              const t = text.trim();
              const num = Number(t);
              if (t !== '' && Number.isFinite(num)) setProjections({ sliceY: num, sliceYExpr: undefined });
              else if (t === '') setProjections({ sliceYExpr: undefined });
              else setProjections({ sliceYExpr: t });
            }}
          />
        </span>
        <button
          className="icon-btn"
          title="Collapse"
          onClick={() => setProjections({ bottomOpen: false })}
        >
          ⌄
        </button>
      </div>
      {/* Constrain the drawing area to the plot's width so the t-axis lines up.
          When the right panel is collapsed, its 22px reopen tab still takes space. */}
      <div className="proj-body" style={{ right: rightOpen ? 'var(--panel-w)' : '22px' }}>
        <canvas
          ref={setRef}
          className="proj-canvas"
          style={{ width: '100%', height: '100%', cursor: maxScroll > 0 ? 'ns-resize' : 'default' }}
          onWheel={(e) => {
            if (maxScroll <= 0) return;
            setScroll((s) => Math.max(0, Math.min(maxScroll, s + (e.deltaY || e.deltaX))));
          }}
        />
      </div>
    </div>
  );
}
