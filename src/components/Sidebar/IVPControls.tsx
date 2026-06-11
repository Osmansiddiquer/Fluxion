import { useStore } from '../../store/useStore';
import type { AnimMode, Entry } from '../../store/types';
import NumberField from './NumberField';
import { PlayButton, ModeButton } from './PlayControls';

/** Pad/trim an initial-condition vector to `order`, defaulting value=1, derivs=0. */
function resolveIC(ic: number[] | undefined, order: number): number[] {
  const out = new Array<number>(order).fill(0);
  out[0] = 1;
  if (ic) for (let i = 0; i < order; i++) if (i < ic.length) out[i] = ic[i];
  return out;
}

function primeLabel(depVar: string, k: number): string {
  return `${depVar}${'′'.repeat(k)}`;
}

/**
 * Initial-value controls for an ODE: a slider+number for t₀ and for each initial
 * condition y(t₀), y′(t₀), … These are the parametrisation ("C") the student slides.
 */
export default function IVPControls({
  entry,
  depVar,
  order,
}: {
  entry: Entry;
  depVar: string;
  order: number;
}) {
  const update = useStore((s) => s.updateEntry);
  const t0 = entry.t0 ?? 0;
  const ic = resolveIC(entry.ic, order);

  const setIC = (k: number, v: number) => {
    const next = ic.slice();
    next[k] = v;
    update(entry.id, { ic: next });
  };
  const mode = entry.animMode ?? 'loop';
  const onMode = (m: AnimMode) => update(entry.id, { animMode: m });

  return (
    <div className="ivp">
      <Row
        label={`t₀`}
        value={t0}
        mode={mode}
        onMode={onMode}
        onChange={(v) => update(entry.id, { t0: v })}
      />
      {ic.map((v, k) => (
        <Row
          key={k}
          label={`${primeLabel(depVar, k)}(t₀)`}
          value={v}
          mode={mode}
          onMode={onMode}
          onChange={(nv) => setIC(k, nv)}
        />
      ))}
    </div>
  );
}

function Row({
  label,
  value,
  mode,
  onMode,
  onChange,
}: {
  label: string;
  value: number;
  mode: AnimMode;
  onMode: (m: AnimMode) => void;
  onChange: (v: number) => void;
}) {
  // A symmetric slider range that always contains the current value.
  const bound = Math.max(10, Math.ceil(Math.abs(value) + 1));
  return (
    <div className="ivp-row">
      <label className="ivp-label">{label}</label>
      <input
        className="range ivp-range"
        type="range"
        min={-bound}
        max={bound}
        step={bound / 100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="play-ctrl">
        <PlayButton value={value} min={-bound} max={bound} mode={mode} onValue={onChange} />
        <ModeButton mode={mode} onMode={onMode} />
      </div>
      <NumberField className="ivp-num" value={value} onCommit={onChange} />
    </div>
  );
}
