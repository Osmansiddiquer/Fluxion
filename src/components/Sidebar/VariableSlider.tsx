import { useStore } from '../../store/useStore';
import type { Entry } from '../../store/types';
import NumberField from './NumberField';
import { PlayButton, ModeButton, SpeedSlider } from './PlayControls';

/**
 * A fine slider step: a power of ten about 1/1000 of the range, so a default
 * −10…10 slider steps by 0.1 and a tighter −1…1 slider by 0.01.
 */
function fineStep(span: number): number {
  if (!(span > 0)) return 0.01;
  return Math.pow(10, Math.floor(Math.log10(span / 100)));
}

export default function VariableSlider({
  entry,
  definedValue,
}: {
  entry: Entry;
  definedValue: number;
}) {
  const update = useStore((s) => s.updateEntry);

  const value = entry.varValue ?? definedValue;
  const min = entry.varMin ?? Math.min(-10, value);
  const max = entry.varMax ?? Math.max(10, value);
  const step = entry.varStep ?? fineStep(max - min);

  return (
    <div className="var-slider">
      <div className="var-track">
        <PlayButton
          value={value}
          min={min}
          max={max}
          mode={entry.animMode ?? 'loop'}
          speed={entry.animSpeed ?? 1}
          onValue={(v) => update(entry.id, { varValue: v })}
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
        <ModeButton mode={entry.animMode ?? 'loop'} onMode={(m) => update(entry.id, { animMode: m })} />
        <SpeedSlider
          speed={entry.animSpeed ?? 1}
          onSpeed={(n) => update(entry.id, { animSpeed: n })}
        />
      </div>
    </div>
  );
}
