import { useStore } from '../store/useStore';

/** Significant-figures selector for displayed numbers (sits beside the theme toggle). */
export default function SigFigs() {
  const sig = useStore((s) => s.sigFigs);
  const setSigFigs = useStore((s) => s.setSigFigs);

  return (
    <label className="sigfig" title="Significant figures shown in readouts">
      <span className="sigfig-mark">0.0#</span>
      <select
        className="sigfig-select"
        value={sig}
        onChange={(e) => setSigFigs(Number(e.target.value))}
        aria-label="Significant figures"
      >
        {[2, 3, 4, 5, 6, 8].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}
