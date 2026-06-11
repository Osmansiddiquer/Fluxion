import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useEntryResult } from '../../state/results';
import { greekWordToGlyph } from '../../lib/math/greek';
import type { Entry } from '../../store/types';
import VariableSlider from './VariableSlider';
import IVPControls from './IVPControls';
import PolarControls from './PolarControls';
import EquationField from './EquationField';
import ColorPopover from './ColorPopover';

function badgeFor(kind: string | undefined, order?: number): string | null {
  switch (kind) {
    case 'ode':
      return order && order > 1 ? `ODE · ${order}` : 'ODE';
    case 'function':
      return 'ƒ';
    case 'variable':
      return 'var';
    case 'implicit':
      return null;
    case 'polar':
      return 'polar';
    default:
      return null;
  }
}

export default function EntryRow({ entry, index }: { entry: Entry; index: number }) {
  const update = useStore((s) => s.updateEntry);
  const remove = useStore((s) => s.removeEntry);
  const reorder = useStore((s) => s.reorderEntry);
  const addAssignment = useStore((s) => s.addAssignment);
  const [dropping, setDropping] = useState(false);
  const res = useEntryResult(entry.id);
  const parsed = res?.parsed;
  const kind = parsed?.kind;
  const [picker, setPicker] = useState(false);

  const undefinedVars = res?.undefinedVars ?? [];
  const error =
    res?.error ?? (parsed && parsed.kind === 'error' ? parsed.message : undefined);
  const hasError = !!error || undefinedVars.length > 0;
  const plottable =
    kind === 'ode' ||
    kind === 'function' ||
    kind === 'implicit' ||
    kind === 'polar' ||
    kind === 'inequality' ||
    kind === 'points' ||
    kind === 'pointvar';
  let badge = badgeFor(kind, parsed && parsed.kind === 'ode' ? parsed.order : undefined);
  if (parsed && (parsed.kind === 'points' || parsed.kind === 'pointvar')) {
    // Use the computed result: a connected line has curve segments.
    const isLine = (res?.curve.segments.length ?? 0) > 0;
    const n = res?.points?.length ?? (parsed.kind === 'points' ? parsed.points.length : 1);
    badge = isLine ? 'line' : n > 1 ? 'points' : 'point';
  }
  const hasControls = kind === 'variable' || kind === 'ode' || kind === 'polar';

  return (
    <div
      className={`entry${entry.visible ? '' : ' entry-hidden'}${dropping ? ' entry-drop' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        const id = e.dataTransfer.getData('text/plain');
        if (id && id !== entry.id) reorder(id, index);
      }}
    >
      <div className="entry-main">
        <span
          className="entry-grip"
          title="Drag to reorder"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', entry.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
        >
          ⠿
        </span>
        <div className="entry-color-wrap">
          {plottable || hasError ? (
            <button
              className={`entry-color${hasError ? ' entry-color-err' : ''}`}
              title={
                hasError
                  ? 'Issue with this expression'
                  : `${entry.visible ? 'Hide' : 'Show'} (right-click for colour)`
              }
              style={
                hasError
                  ? undefined
                  : entry.visible
                    ? { background: entry.color, borderColor: entry.color }
                    : { background: 'transparent', borderColor: entry.color }
              }
              onClick={() => update(entry.id, { visible: !entry.visible })}
              onContextMenu={(e) => {
                e.preventDefault();
                setPicker((p) => !p);
              }}
            >
              {hasError ? '!' : ''}
            </button>
          ) : (
            <span className="entry-index">{index + 1}</span>
          )}
          {picker && <ColorPopover entry={entry} onClose={() => setPicker(false)} />}
        </div>

        <EquationField entry={entry} />

        {badge && <span className={`entry-badge badge-${kind}`}>{badge}</span>}
        {hasControls && (
          <button
            className="icon-btn entry-expand"
            title={entry.expanded ? 'Collapse' : 'Expand controls'}
            onClick={() => update(entry.id, { expanded: !entry.expanded })}
          >
            {entry.expanded ? '▾' : '▸'}
          </button>
        )}
        <button className="icon-btn entry-del" title="Delete" onClick={() => remove(entry.id)}>
          ✕
        </button>
      </div>

      {undefinedVars.length > 0 && (
        <div className="entry-define">
          <span className="define-msg">
            Define {undefinedVars.length > 1 ? 'these:' : ''}
          </span>
          {undefinedVars.map((v) => {
            const glyph = greekWordToGlyph(v);
            return (
              <button key={v} className="define-btn" onClick={() => addAssignment(glyph)}>
                {glyph} = …
              </button>
            );
          })}
        </div>
      )}
      {!undefinedVars.length && error && <div className="entry-error">{error}</div>}

      {entry.expanded && parsed?.kind === 'variable' && (
        <VariableSlider entry={entry} definedValue={parsed.value} />
      )}
      {entry.expanded && parsed?.kind === 'ode' && (
        <IVPControls entry={entry} depVar={parsed.depVar} order={parsed.order} />
      )}
      {entry.expanded && parsed?.kind === 'polar' && <PolarControls entry={entry} />}
    </div>
  );
}
