import { useEffect, useState } from 'react';
import katex from 'katex';
import { useStore } from '../store/useStore';
import type { Entry, FeatureToggles, Projections, Viewport } from '../store/types';
import { APP_NAME } from '../config';
import './Tutorial.css';

/* A small inline KaTeX chip — used for the syntax examples. */
function Tex({ children, className }: { children: string; className?: string }) {
  const html = katex.renderToString(children, { throwOnError: false });
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

let seed = 0;
function ex(raw: string, color: string, extra: Partial<Entry> = {}): Entry {
  return { id: `tut${seed++}`, raw, color, visible: true, expanded: false, ...extra };
}

const FEATURES: FeatureToggles = {
  extrema: true,
  xIntercepts: true,
  yIntercept: true,
  endpoints: false,
  discontinuities: true,
  intersections: true,
};
const PANELS_OFF: Projections = { rightOpen: false, bottomOpen: false, sliceT: 0, sliceY: 1 };

interface Example {
  title: string;
  blurb: string;
  tex: string;
  entries: Entry[];
  viewport: Viewport;
  projections?: Projections;
}

const EXAMPLES: Example[] = [
  {
    title: 'Harmonic motion',
    blurb: "A 2nd-order ODE solved from its initial conditions — y(0)=0, y'(0)=1.",
    tex: "y'' = -y",
    entries: [ex("y'' = -y", '#c74440', { t0: 0, ic: [0, 1], expanded: true })],
    viewport: { tMin: -1, tMax: 13, yMin: -2, yMax: 2 },
    projections: { rightOpen: true, bottomOpen: true, sliceT: 2.5, sliceY: 1 },
  },
  {
    title: 'Logistic growth',
    blurb: 'A nonlinear ODE — population that levels off at its carrying capacity.',
    tex: 'y\\,\' = y\\,(1 - y/4)',
    entries: [ex("y' = y (1 - y/4)", '#388c46', { t0: 0, ic: [0.4], expanded: true })],
    viewport: { tMin: -1, tMax: 11, yMin: -0.5, yMax: 5 },
  },
  {
    title: 'Spiral region',
    blurb: 'A polar inequality swept over θ — the shaded area inside an Archimedean spiral.',
    tex: 'r < 2\\theta',
    entries: [ex('r < 2theta', '#6042a6', { thetaMin: 0, thetaMax: 4 * Math.PI, expanded: true })],
    viewport: { tMin: -28, tMax: 28, yMin: -18, yMax: 18 },
  },
  {
    title: 'Rose curve',
    blurb: 'A polar curve r = f(θ). Try editing the 3 to change the number of petals.',
    tex: 'r = 3\\sin(3\\theta)',
    entries: [ex('r = 3 sin(3theta)', '#c74440', { expanded: true })],
    viewport: { tMin: -4.5, tMax: 4.5, yMin: -3, yMax: 3 },
  },
];

const SYNTAX: { tex: string; label: string }[] = [
  { tex: "y'' = -y", label: 'Differential equations — any order & systems' },
  { tex: 'y = \\sin t', label: 'Plain functions of t (or x)' },
  { tex: 'r = 2\\theta', label: 'Polar curves' },
  { tex: '1 < y < \\sin t', label: 'Inequalities — shaded regions' },
  { tex: '(2,\\ 1)', label: 'Points & lines' },
  { tex: 'a = 2', label: 'Variables become sliders' },
];

const INSPECT: { icon: string; text: string }[] = [
  { icon: '◆', text: 'Markers for extrema, intercepts & discontinuities appear automatically.' },
  { icon: '⊹', text: 'Hover any curve to trace exact values along it.' },
  { icon: '⊞', text: 'The bottom & right panels read linked cross-sections at the cursor.' },
  { icon: '▶', text: 'Drag — or animate — initial-condition and variable sliders.' },
  { icon: '↗', text: 'Share a link or export your graph from the top bar anytime.' },
];

export default function Tutorial({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const loadGraph = useStore((s) => s.loadGraph);
  const sigFigs = useStore((s) => s.sigFigs);
  const STEPS = 4;

  // Reset to the first step each time the tour is (re)opened.
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  // Esc closes; arrows page through.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setStep((s) => Math.min(STEPS - 1, s + 1));
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const launch = (e: Example) => {
    loadGraph({
      entries: e.entries.map((en) => ({ ...en, id: `${en.id}-${Date.now()}` })),
      viewport: e.viewport,
      features: FEATURES,
      projections: e.projections ?? PANELS_OFF,
      sigFigs,
    });
    onClose();
  };

  return (
    <div className="tut-backdrop" onClick={onClose}>
      <div
        className="tut-card"
        role="dialog"
        aria-modal="true"
        aria-label={`${APP_NAME} getting started`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="tut-x" title="Close" aria-label="Close" onClick={onClose}>
          ✕
        </button>

        <div className="tut-body">
          {step === 0 && (
            <section className="tut-step tut-welcome">
              <div className="tut-mark">Ḟ</div>
              <h1>
                Welcome to <span>{APP_NAME}</span>
              </h1>
              <p className="tut-lede">
                A graphing calculator built for <strong>differential equations</strong>. Type an
                equation and watch it solve — numerically, and live.
              </p>
              <div className="tut-hero-row">
                <Tex className="tut-hero-tex">y'' = -y</Tex>
                <span className="tut-arrow">→</span>
                <Tex className="tut-hero-tex">y(t) = \sin t</Tex>
              </div>
            </section>
          )}

          {step === 1 && (
            <section className="tut-step">
              <h2>Type anything</h2>
              <p className="tut-sub">
                Each row in the left panel is one expression. Fluxion figures out what it is.
              </p>
              <div className="tut-grid">
                {SYNTAX.map((s) => (
                  <div className="tut-syntax" key={s.tex}>
                    <Tex className="tut-syntax-tex">{s.tex}</Tex>
                    <span className="tut-syntax-label">{s.label}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="tut-step">
              <h2>Inspect &amp; explore</h2>
              <p className="tut-sub">Fluxion doesn’t just draw — it helps you read the curve.</p>
              <ul className="tut-list">
                {INSPECT.map((it) => (
                  <li key={it.text}>
                    <span className="tut-li-icon">{it.icon}</span>
                    <span>{it.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {step === 3 && (
            <section className="tut-step">
              <h2>Start with an example</h2>
              <p className="tut-sub">Pick one to load it — then make it your own.</p>
              <div className="tut-examples">
                {EXAMPLES.map((e) => (
                  <button className="tut-example" key={e.title} onClick={() => launch(e)}>
                    <Tex className="tut-example-tex">{e.tex}</Tex>
                    <span className="tut-example-title">{e.title}</span>
                    <span className="tut-example-blurb">{e.blurb}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <footer className="tut-foot">
          <div className="tut-dots">
            {Array.from({ length: STEPS }, (_, i) => (
              <button
                key={i}
                className={`tut-dot${i === step ? ' active' : ''}`}
                aria-label={`Go to step ${i + 1}`}
                onClick={() => setStep(i)}
              />
            ))}
          </div>
          <div className="tut-nav">
            {step === 0 ? (
              <button className="tut-btn-ghost" onClick={onClose}>
                Skip
              </button>
            ) : (
              <button className="tut-btn-ghost" onClick={() => setStep((s) => s - 1)}>
                Back
              </button>
            )}
            {step < STEPS - 1 ? (
              <button className="tut-btn" onClick={() => setStep((s) => s + 1)}>
                Next
              </button>
            ) : (
              <button className="tut-btn" onClick={onClose}>
                Start exploring
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
