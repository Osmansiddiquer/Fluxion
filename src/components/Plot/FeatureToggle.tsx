import { useState } from 'react';
import { useStore } from '../../store/useStore';
import type { FeatureToggles } from '../../store/types';

const ITEMS: { key: keyof FeatureToggles; label: string }[] = [
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
  const activeCount = ITEMS.filter((i) => toggles[i.key]).length;

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
        </div>
      )}
    </div>
  );
}
