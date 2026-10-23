import { useStore } from '../../store/useStore';
import { useEntryResult } from '../../state/results';
import { stateName } from '../../lib/ode/view';
import type { Entry } from '../../store/types';

/**
 * The ODE row's view switches, under the IVP sliders. "The equation decides
 * what you see": each control appears only when it applies.
 *
 * - **vs t | phase**: when the coupled state is 2-D or more (a system, or a
 *   2nd-order equation read as (y, y′)). Group-wide: set on the group's first row.
 * - **Field**: a slope field (first-order equation against t) or the vector
 *   field + nullclines (2-D phase plane).
 * - **Axes**: which two state components to plot, for 3-D+ phase planes.
 * - **Clear extra solutions**: only once shift-click has added some.
 *
 * Group-level settings are shown on the leader row (the group's first row) only.
 */
export default function OdeViewControls({ entry }: { entry: Entry }) {
  const res = useEntryResult(entry.id);
  const entries = useStore((s) => s.entries);
  const update = useStore((s) => s.updateEntry);
  const ode = res?.ode;
  if (!ode) return null;
  if (!ode.isLeader) {
    // The group's switches live on its first row; say where this row went.
    return ode.phase ? (
      <div className="ode-view">
        <div className="ode-note">Drawn in the phase plane with the system’s first row (switch it there).</div>
      </div>
    ) : null;
  }
  const leader = entry;
  const members = entries.filter((e) => ode.groupIds.includes(e.id));
  const phase = !!ode.phase;
  const canPhase = ode.dim >= 2;
  const extras = leader.extraICs?.length ?? 0;
  if (!canPhase && !ode.fieldKind && !extras) return null;

  const setPhase = (on: boolean) => {
    if (on) update(leader.id, { phase: true });
    else for (const m of members) if (m.phase || m.phaseAxes) update(m.id, { phase: undefined, phaseAxes: undefined });
  };
  const symbols = ode.stateLabels;
  const axes = ode.phase?.axes ?? [0, 1];
  const names = symbols.map((s) => s.replace(/′/g, "'"));
  const setAxis = (which: 0 | 1, idx: number) => {
    const next: [number, number] = [axes[0], axes[1]];
    next[which] = idx;
    if (next[0] === next[1]) next[1 - which] = axes[which];
    update(leader.id, { phase: true, phaseAxes: [stateName(names[next[0]]), stateName(names[next[1]])] });
  };

  return (
    <div className="ode-view">
      {canPhase && (
        <div className="ode-view-row">
          <span className="ode-view-label">Plot</span>
          <div className="seg" role="radiogroup" aria-label="Plot against t or in the phase plane">
            <button
              className={`seg-btn${phase ? '' : ' active'}`}
              role="radio"
              aria-checked={!phase}
              title="Each component against t"
              onClick={() => setPhase(false)}
            >
              vs t
            </button>
            <button
              className={`seg-btn${phase ? ' active' : ''}`}
              role="radio"
              aria-checked={phase}
              title={`Phase plane: ${symbols[axes[1]]} against ${symbols[axes[0]]}`}
              onClick={() => setPhase(true)}
            >
              phase
            </button>
          </div>
        </div>
      )}
      {phase && ode.dim >= 3 && (
        <div className="ode-view-row">
          <span className="ode-view-label">Axes</span>
          <div className="ode-axes">
            {([0, 1] as const).map((which) => (
              <select
                key={which}
                className="adv-select"
                aria-label={which === 0 ? 'Horizontal axis' : 'Vertical axis'}
                value={axes[which]}
                onChange={(e) => setAxis(which, Number(e.target.value))}
              >
                {symbols.map((s, i) => (
                  <option key={s} value={i}>
                    {s}
                  </option>
                ))}
              </select>
            ))}
          </div>
        </div>
      )}
      {ode.fieldKind && (
        <div className="ode-view-row">
          <span className="ode-view-label">{ode.fieldKind === 'slope' ? 'Slope field' : 'Field & nullclines'}</span>
          <button
            className={`style-toggle${ode.fieldOn ? ' on' : ''}`}
            role="switch"
            aria-checked={ode.fieldOn}
            aria-label={ode.fieldKind === 'slope' ? 'Slope field' : 'Vector field and nullclines'}
            title={ode.fieldOn ? 'Hide the field' : 'Show the field'}
            onClick={() => update(leader.id, { field: !ode.fieldOn })}
          >
            <span />
          </button>
        </div>
      )}
      {extras > 0 && (
        <div className="ode-view-row">
          <button className="ode-clear" onClick={() => update(leader.id, { extraICs: undefined })}>
            Clear {extras} extra solution{extras === 1 ? '' : 's'}
          </button>
        </div>
      )}
      {ode.canAddSolutions && (ode.fieldOn || extras > 0) && (
        <div className="ode-hint">Shift-click the plot to add a solution · drag the ring to move the start</div>
      )}
    </div>
  );
}
