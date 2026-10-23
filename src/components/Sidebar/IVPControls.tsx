import { useStore } from '../../store/useStore';
import type { AnimMode, Entry } from '../../store/types';
import { useEntryResult } from '../../state/results';
import { DEFAULT_BC } from '../../lib/solver/odeGroup';
import { fmtSig } from '../../lib/format';
import NumberField from './NumberField';
import { PlayButton, ModeButton } from './PlayControls';
import NumericsPanel, { ConditionsSwitch } from './NumericsPanel';

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
 * Values typed in the equation (`y(0) = 1`) show here read-only. A 2nd-order
 * equation can switch to boundary values; the Numerics disclosure sits last.
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
  const res = useEntryResult(entry.id);
  const numerics = res?.numerics;
  const t0 = entry.t0 ?? 0;
  const ic = resolveIC(entry.ic, order);
  const indep = res?.parsed.kind === 'ode' && res.parsed.indep === 'x' ? 'x' : 't';

  const setIC = (k: number, v: number) => {
    const next = ic.slice();
    next[k] = v;
    update(entry.id, { ic: next });
  };
  const mode = entry.animMode ?? 'loop';
  const onMode = (m: AnimMode) => update(entry.id, { animMode: m });

  const typedAny = !!numerics && (numerics.typedT0 || !!numerics.bvp?.typed);
  const typedText = numerics?.typedText ?? [];
  const boundary = order === 2 && entry.conditions === 'boundary' && !typedAny;
  const bc = entry.bc && entry.bc.length === 4 ? entry.bc : [...DEFAULT_BC];
  const setBC = (i: number, v: number) => {
    const next = bc.slice();
    next[i] = v;
    update(entry.id, { bc: next });
  };
  const sub = `${indep}₀`;

  return (
    <div className="ivp">
      {order === 2 && <ConditionsSwitch entry={entry} typed={typedAny} />}
      {typedText.length > 0 && (
        <div className="num-note num-typed">
          From the equation: <span className="num-mono">{typedText.join(', ')}</span>
        </div>
      )}
      {boundary ? (
        <>
          <Row label="a" value={bc[0]} mode={mode} onMode={onMode} onChange={(v) => setBC(0, v)} />
          <Row label={`${depVar}(a)`} value={bc[1]} mode={mode} onMode={onMode} onChange={(v) => setBC(1, v)} />
          <Row label="b" value={bc[2]} mode={mode} onMode={onMode} onChange={(v) => setBC(2, v)} />
          <Row label={`${depVar}(b)`} value={bc[3]} mode={mode} onMode={onMode} onChange={(v) => setBC(3, v)} />
        </>
      ) : numerics?.bvp?.typed ? null : (
        <>
          <Row
            label={sub}
            value={numerics?.typedT0 ? numerics.t0 : t0}
            disabled={numerics?.typedT0}
            mode={mode}
            onMode={onMode}
            onChange={(v) => update(entry.id, { t0: v })}
          />
          {ic.map((v, k) => (
            <Row
              key={k}
              label={`${primeLabel(depVar, k)}(${sub})`}
              value={numerics?.typedIc[k] ? numerics.ic[k] : v}
              disabled={numerics?.typedIc[k]}
              mode={mode}
              onMode={onMode}
              onChange={(nv) => setIC(k, nv)}
            />
          ))}
        </>
      )}
      {numerics?.bvp && (
        <div className="num-note">
          Shooting found{' '}
          <span className="num-mono">
            {primeLabel(depVar, numerics.bvp.ia === 0 ? 1 : 0)}({fmtSig(numerics.bvp.a)}) = {fmtSig(numerics.ic[numerics.bvp.ia === 0 ? 1 : 0])}
          </span>
        </div>
      )}
      <NumericsPanel entry={entry} numerics={numerics} />
    </div>
  );
}

function Row({
  label,
  value,
  mode,
  onMode,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  mode: AnimMode;
  onMode: (m: AnimMode) => void;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  // A symmetric slider range that always contains the current value.
  const bound = Math.max(10, Math.ceil(Math.abs(value) + 1));
  return (
    <div className={`ivp-row${disabled ? ' ivp-row-typed' : ''}`} title={disabled ? 'Set by the condition typed in the equation' : undefined}>
      <label className="ivp-label">{label}</label>
      <input
        className="range ivp-range"
        type="range"
        min={-bound}
        max={bound}
        step={bound / 100}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="play-ctrl">
        {!disabled && <PlayButton value={value} min={-bound} max={bound} mode={mode} onValue={onChange} />}
        {!disabled && <ModeButton mode={mode} onMode={onMode} />}
      </div>
      {disabled ? (
        <span className="ivp-num ivp-num-typed">{Number(value.toPrecision(8))}</span>
      ) : (
        <NumberField className="ivp-num" value={value} onCommit={onChange} />
      )}
    </div>
  );
}
