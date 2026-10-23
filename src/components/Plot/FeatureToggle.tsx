import { useState } from 'react';
import { useStore } from '../../store/useStore';
import type { ToggleKey } from '../../store/types';
import { useResults } from '../../state/results';

const ITEMS: { key: ToggleKey; label: string }[] = [
  { key: 'extrema', label: 'Maxima & minima' },
  { key: 'xIntercepts', label: 'x-intercepts' },
  { key: 'yIntercept', label: 'y-intercept' },
  { key: 'intersections', label: 'Intersections' },
  { key: 'discontinuities', label: 'Discontinuities' },
  { key: 'endpoints', label: 'Endpoints' },
];

export default function FeatureToggle() {
  const [open, setOpen] = useState(false);
  const toggles = useStore((s) => s.features);
  const setFeatures = useStore((s) => s.setFeatures);
  const results = useResults();
  // Equilibria apply only to ODEs: the item appears when the graph has one.
  const hasOde = [...results.values()].some((r) => r.parsed.kind === 'ode');
  const eqOn = toggles.equilibria !== false;
  const activeCount = ITEMS.filter((i) => toggles[i.key]).length + (hasOde && eqOn ? 1 : 0);

  return (
    <div className={`feat${open ? ' feat-open' : ''}`}>
      <button
        className="feat-btn"
        onClick={() => setOpen((o) => !o)}
        title="Points of interest"
      >
        <span className="feat-icon">◎</span>
        Points
        <span className="feat-count">{activeCount}</span>
      </button>
      {open && (
        <div className="feat-menu">
          {ITEMS.map((i) => (
            <label key={i.key} className="feat-item">
              <input
                type="checkbox"
                checked={toggles[i.key]}
                onChange={(e) => setFeatures({ [i.key]: e.target.checked })}
              />
              <span>{i.label}</span>
            </label>
          ))}
          {hasOde && (
            <label className="feat-item">
              <input type="checkbox" checked={eqOn} onChange={(e) => setFeatures({ equilibria: e.target.checked })} />
              <span>Equilibria</span>
            </label>
          )}
          <div className="feat-sep" role="separator" />
          <label className="feat-item">
            <input
              type="checkbox"
              checked={toggles.grid !== false}
              onChange={(e) => setFeatures({ grid: e.target.checked })}
            />
            <span>Grid &amp; axes</span>
          </label>
        </div>
      )}
    </div>
  );
}
