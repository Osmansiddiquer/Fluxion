import { useStore } from '../../store/useStore';
import type { Entry } from '../../store/types';
import NumberField from './NumberField';
import { VarPlayButton, ModeButton, SpeedSlider, StepButtons } from './PlayControls';
import { sliderBounds, stepValue } from '../../lib/anim';

export default function VariableSlider({
  entry,
  definedValue,
}: {
  entry: Entry;
  definedValue: number;
}) {
  const update = useStore((s) => s.updateEntry);

  const { value, min, max, step } = sliderBounds(entry, definedValue);

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
