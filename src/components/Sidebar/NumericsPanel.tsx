import { useState } from 'react';
import { useStore } from '../../store/useStore';
import type { AnimMode, Entry } from '../../store/types';
import type { OdeNumerics } from '../../lib/solver/odeGroup';
import { DEFAULT_SOLVER, SOLVER_METHODS, type SolverMethod } from '../../lib/solver/integrate';
import {
  DEFAULT_STEP_SIZE,
  MAX_SHOWN_STEPS,
  STEP_METHODS,
  STEP_METHOD_LABELS,
  STEP_ORDER,
  type StepMethod,
} from '../../lib/solver/methods';
import { fmtSig } from '../../lib/format';
import NumberField from './NumberField';
import { PlayButton, ModeButton } from './PlayControls';

/**
 * ODE numerics, collapsed under "Numerics" in the expanded ODE row (open by
 * default only when an option is already set): the integrator, and "Show steps"
 * — a textbook method with an explicit h drawn over the accurate solution.
 */

export const SOLVER_LABELS: Record<SolverMethod, string> = { auto: 'Auto', rk45: 'RK45', rk4: 'RK4', euler: 'Euler' };
const SOLVER_TITLES: Record<SolverMethod, string> = {
  auto: 'Adaptive Dormand–Prince RK45 with error control; switches to an implicit (Rosenbrock) method on stiff problems',
  rk45: 'Adaptive Dormand–Prince RK45 with error control and dense output',
  rk4: 'Classic fixed-step Runge–Kutta (4th order), about one step per sample',
  euler: 'Forward Euler at the same fixed step (1st order: visibly less accurate)',
};

/** h slider range (log scale). */
const H_MIN = 0.01;
const H_MAX = 2;
const LOG_MIN = Math.log10(H_MIN);
const LOG_MAX = Math.log10(H_MAX);

function solverReadout(n: OdeNumerics | undefined): string {
  if (!n) return '';
  const s = n.stats;
  const parts = [`${s.steps} step${s.steps === 1 ? '' : 's'}`];
  if (s.rejected) parts.push(`${s.rejected} rejected`);
  if (s.stiff) parts.push('stiff: switched to implicit');
  if (s.stopped === 'budget') parts.push('stopped at the step limit');
  return parts.join(' · ');
}

export default function NumericsPanel({ entry, numerics }: { entry: Entry; numerics?: OdeNumerics }) {
  const update = useStore((s) => s.updateEntry);
  const [open, setOpen] = useState(entry.solver !== undefined || entry.steps !== undefined);
  const solver = entry.solver ?? DEFAULT_SOLVER;
  const method = entry.steps;
  const h = entry.stepSize ?? DEFAULT_STEP_SIZE;
  const mode: AnimMode = entry.animMode ?? 'bounce';
  const setH = (v: number) => update(entry.id, { stepSize: Number(Math.min(100, Math.max(1e-3, v)).toPrecision(3)) });
  const steps = numerics?.steps;

  let errLine = '';
  if (steps) {
    let i = 0;
    for (let k = 1; k < steps.err.length; k++) if (steps.err[k] > steps.err[i]) i = k;
    const p = STEP_ORDER[steps.method];
    errLine =
      `max |yₕ − y| = ${fmtSig(steps.err[i] ?? 0)} at t = ${fmtSig(steps.ts[i] ?? 0)}` +
      ` · order ${p}: halving h divides the error by about ${2 ** p}`;
  }

  return (
    <div className="adv-opts num-opts">
      <button className="adv-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`adv-caret${open ? ' open' : ''}`} aria-hidden="true">▸</span>
        Numerics
      </button>
      {open && (
        <div className="adv-body num-body">
          <div className="point-opt-row">
            <span className="point-opt-label num-label">Solver</span>
            <div className="seg" role="group" aria-label="Solver">
              {SOLVER_METHODS.map((m) => (
                <button
                  key={m}
                  className={`seg-btn${solver === m ? ' active' : ''}`}
                  title={SOLVER_TITLES[m] + (m === DEFAULT_SOLVER ? ' (default)' : '')}
                  aria-pressed={solver === m}
                  onClick={() => update(entry.id, { solver: m === DEFAULT_SOLVER ? undefined : m })}
                >
                  {SOLVER_LABELS[m]}
                </button>
              ))}
            </div>
          </div>
          {numerics && <div className="num-note">{solverReadout(numerics)}</div>}

          <label className="num-check">
            <input
              type="checkbox"
              checked={!!method}
              onChange={(e) => update(entry.id, { steps: e.target.checked ? 'euler' : undefined })}
            />
            Show steps
          </label>
          {method && (
            <>
              <div className="point-opt-row">
                <span className="point-opt-label num-label">Method</span>
                <div className="seg" role="group" aria-label="Step method">
                  {STEP_METHODS.map((m: StepMethod) => (
                    <button
                      key={m}
                      className={`seg-btn${method === m ? ' active' : ''}`}
                      aria-pressed={method === m}
                      title={`${STEP_METHOD_LABELS[m]}: global error O(h${m === 'euler' ? '' : m === 'heun' ? '²' : '⁴'})`}
                      onClick={() => update(entry.id, { steps: m })}
                    >
                      {STEP_METHOD_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ivp-row num-h-row">
                <label className="ivp-label" htmlFor={`h-${entry.id}`}>
                  h
                </label>
                <input
                  id={`h-${entry.id}`}
                  className="range ivp-range"
                  type="range"
                  min={LOG_MIN}
                  max={LOG_MAX}
                  step={0.005}
                  aria-label="Step size h (log scale)"
                  value={Math.log10(Math.min(H_MAX, Math.max(H_MIN, h)))}
                  onChange={(e) => setH(10 ** Number(e.target.value))}
                />
                <div className="play-ctrl">
                  <PlayButton
                    value={Math.log10(Math.min(H_MAX, Math.max(H_MIN, h)))}
                    min={LOG_MIN}
                    max={LOG_MAX}
                    mode={mode}
                    onValue={(v) => setH(10 ** v)}
                  />
                  <ModeButton mode={mode} onMode={(m) => update(entry.id, { animMode: m })} />
                </div>
                <NumberField className="ivp-num" value={h} ariaLabel="Step size h" onCommit={(v) => v > 0 && setH(v)} />
              </div>
              {steps && (
                <div className="num-note">
                  {steps.ts.length - 1} steps{steps.truncated ? ` (first ${MAX_SHOWN_STEPS} each way)` : ''} · {errLine}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** "Conditions: initial | boundary" — only for 2nd-order equations. */
export function ConditionsSwitch({ entry, typed }: { entry: Entry; typed: boolean }) {
  const update = useStore((s) => s.updateEntry);
  const boundary = entry.conditions === 'boundary';
  return (
    <div className="point-opt-row num-cond">
      <span className="point-opt-label num-label">Conditions</span>
      <div className="seg" role="group" aria-label="Conditions">
        {(
          [
            ['initial', 'Initial'],
            ['boundary', 'Boundary'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            className={`seg-btn${(boundary ? 'boundary' : 'initial') === v ? ' active' : ''}`}
            aria-pressed={(boundary ? 'boundary' : 'initial') === v}
            disabled={typed}
            title={
              typed
                ? 'Set by the conditions typed in the equation'
                : v === 'initial'
                  ? 'Initial values y(t₀), y′(t₀)'
                  : 'Boundary values y(a) = α, y(b) = β (solved by shooting)'
            }
            onClick={() => update(entry.id, { conditions: v === 'initial' ? undefined : 'boundary' })}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
