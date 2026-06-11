import { useEffect, useRef, type ReactNode } from 'react';
import { useStore } from '../../store/useStore';
import { useEntryResult } from '../../state/results';
import { PALETTE } from '../../utils/colors';
import type { Entry, PointDir } from '../../store/types';

const DIR_CELLS: (PointDir | 'c')[] = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se'];
const ARROW = { strokeWidth: 1.5, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const IconX = (
  <svg viewBox="0 0 16 16" width="15" height="15" stroke="currentColor">
    <path d="M2.5 8 H13.5 M2.5 8 L5 5.5 M2.5 8 L5 10.5 M13.5 8 L11 5.5 M13.5 8 L11 10.5" {...ARROW} />
  </svg>
);
const IconY = (
  <svg viewBox="0 0 16 16" width="15" height="15" stroke="currentColor">
    <path d="M8 2.5 V13.5 M8 2.5 L5.5 5 M8 2.5 L10.5 5 M8 13.5 L5.5 11 M8 13.5 L10.5 11" {...ARROW} />
  </svg>
);
const IconBoth = (
  <svg viewBox="0 0 16 16" width="15" height="15" stroke="currentColor">
    <path
      d="M8 3 V13 M3 8 H13 M8 3 L6.3 5 M8 3 L9.7 5 M8 13 L6.3 11 M8 13 L9.7 11 M3 8 L5 6.3 M3 8 L5 9.7 M13 8 L11 6.3 M13 8 L11 9.7"
      {...ARROW}
    />
  </svg>
);

const DRAG_OPTS: {
  value: 'auto' | 'off' | 'x' | 'y' | 'both';
  label: ReactNode;
  title: string;
}[] = [
  { value: 'auto', label: 'Auto', title: 'Draggable where coordinates are variables' },
  { value: 'off', label: 'Off', title: 'Not draggable' },
  { value: 'x', label: IconX, title: 'Horizontal only' },
  { value: 'y', label: IconY, title: 'Vertical only' },
  { value: 'both', label: IconBoth, title: 'Both axes' },
];

export default function ColorPopover({
  entry,
  onClose,
}: {
  entry: Entry;
  onClose: () => void;
}) {
  const update = useStore((s) => s.updateEntry);
  const res = useEntryResult(entry.id);
  const ref = useRef<HTMLDivElement>(null);

  const isPoints = res?.parsed.kind === 'points' || res?.parsed.kind === 'pointvar';
  const singlePoint =
    res?.parsed.kind === 'pointvar' ||
    (res?.parsed.kind === 'points' && !res.parsed.polyline && res.parsed.points.length === 1);
  const dir = entry.pointLabelDir ?? 'ne';
  const drag = entry.pointDrag ?? 'auto';
  const size = entry.pointSize ?? 6;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <div className="color-pop" ref={ref}>
      <div className="color-swatches">
        {PALETTE.map((c) => (
          <button
            key={c}
            className={`color-swatch${entry.color === c ? ' selected' : ''}`}
            style={{ background: c }}
            onClick={() => update(entry.id, { color: c })}
            aria-label={`Set colour ${c}`}
          />
        ))}
      </div>
      <div className="color-row">
        <label className="color-custom">
          <input
            type="color"
            value={entry.color}
            onChange={(e) => update(entry.id, { color: e.target.value })}
          />
          <span>Custom</span>
        </label>
        <button
          className="color-vis"
          onClick={() => update(entry.id, { visible: !entry.visible })}
        >
          {entry.visible ? 'Hide' : 'Show'}
        </button>
      </div>

      {isPoints && (
        <div className="point-opts">
          <div className="point-opt-row">
            <span className="point-opt-label">Size</span>
            <input
              className="range"
              type="range"
              min={2}
              max={14}
              step={1}
              value={size}
              onChange={(e) => update(entry.id, { pointSize: Number(e.target.value) })}
            />
          </div>
          <div className="point-opt-row">
            <span className="point-opt-label">Drag</span>
            <div className="seg">
              {DRAG_OPTS.map((o) => (
                <button
                  key={o.value}
                  className={`seg-btn${drag === o.value ? ' active' : ''}`}
                  title={o.title}
                  onClick={() => update(entry.id, { pointDrag: o.value })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {singlePoint && (
            <div className="point-opt-row point-opt-label-row">
              <input
                className="point-label-input"
                placeholder="label (LaTeX)"
                value={entry.pointLabel ?? ''}
                onChange={(e) => update(entry.id, { pointLabel: e.target.value })}
              />
              <div className="dir-grid" title="Label position">
                {DIR_CELLS.map((c) =>
                  c === 'c' ? (
                    <span key="c" className="dir-center" />
                  ) : (
                    <button
                      key={c}
                      className={`dir-cell${dir === c ? ' sel' : ''}`}
                      aria-label={`Place label ${c}`}
                      onClick={() => update(entry.id, { pointLabelDir: c })}
                    />
                  ),
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
