import { useStore } from '../../store/useStore';
import type { Entry } from '../../store/types';
import NumberField from './NumberField';
import { VarPlayButton, ModeButton, SpeedSlider, StepButtons } from './PlayControls';
import { sliderBounds, stepValue } from '../../lib/anim';
import { useResults } from '../../state/results';
import { callsOf } from '../../lib/compute';
import { isDerived } from '../../lib/scope';
import { familyApplies, FAMILY_N } from '../../lib/ode/view';
import type { Parsed } from '../../lib/math/parse';

const FamilyIcon = (
  <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
    <path
      d="M2 12 C5 12 7 4 14 3 M2 12 C5 12 8 7 14 7 M2 12 C6 12 9 10 14 11"
      stroke="currentColor"
      strokeWidth={1.4}
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);

export default function VariableSlider({
  entry,
  definedValue,
}: {
  entry: Entry;
  definedValue: number;
}) {
  const update = useStore((s) => s.updateEntry);

  const { value, min, max, step } = sliderBounds(entry, definedValue);
  // The family switch shows only when a function or ODE depends on this slider.
  const results = useResults();
  const self = results.get(entry.id)?.parsed;
  const name = self?.kind === 'variable' ? self.name : undefined;
  const hasFamily =
    !!name &&
    familyApplies(
      name,
      [...results.values()].map(({ parsed: p }) => ({
        kind: p.kind,
        name: 'name' in p ? (p as { name?: string }).name : undefined,
        deps: 'deps' in p ? (p as { deps: string[] }).deps : undefined,
        calls: [...callsOf(p)],
        derived: (isDerived as (x: Parsed) => boolean)(p),
      })),
    );

  return (
    <div className="var-slider">
      <div className="var-track">
        <VarPlayButton
          id={entry.id}
          // Pausing an auto-playing (demo) variable keeps it paused on reload.
          onPause={() => entry.autoplay && update(entry.id, { autoplay: undefined })}
        />
        <NumberField
          className="var-bound"
          ariaLabel="minimum"
          value={min}
          onCommit={(n) => update(entry.id, { varMin: n })}
        />
        <input
          className="range"
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.min(max, Math.max(min, value))}
          onChange={(e) => update(entry.id, { varValue: Number(e.target.value) })}
        />
        <NumberField
          className="var-bound"
          ariaLabel="maximum"
          value={max}
          onCommit={(n) => update(entry.id, { varMax: n })}
        />
      </div>
      <div className="var-controls">
        {(hasFamily || entry.family) && (
          <button
            className={`family-btn${entry.family ? ' on' : ''}`}
            aria-pressed={!!entry.family}
            title={
              entry.family
                ? 'Hide the family of curves'
                : `Family: draw ${FAMILY_N} curves for values across ${min} … ${max}`
            }
            onClick={() => update(entry.id, { family: entry.family ? undefined : true })}
          >
            {FamilyIcon}
          </button>
        )}
        <StepButtons
          onStep={(dir) => update(entry.id, { varValue: stepValue(value, min, max, step, dir) })}
        />
        <ModeButton mode={entry.animMode ?? 'loop'} onMode={(m) => update(entry.id, { animMode: m })} />
        <SpeedSlider
          speed={entry.animSpeed ?? 1}
          onSpeed={(n) => update(entry.id, { animSpeed: n })}
        />
      </div>
    </div>
  );
}
