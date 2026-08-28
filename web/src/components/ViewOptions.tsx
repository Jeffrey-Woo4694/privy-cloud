import { useEffect } from 'react';
import { SORT_PRESETS, presetIdFor, type Sort } from '../sortItems';

export type DisplaySize = 'small' | 'medium' | 'large';

/** The "view options" popover: icon size stepper, named sort radios (A-Z, Z-A,
 *  Last/First Modified, Size, Type), and a Show Hidden Files toggle. Opened from
 *  the ⋯ button beside the grid/list toggle, closes on backdrop click / Escape. */
export function ViewOptions({ open, onClose, sort, onSort, displaySize, onDisplaySize, showHidden, onShowHidden }: {
  open: boolean; onClose: () => void;
  sort: Sort; onSort: (s: Sort) => void;
  displaySize: DisplaySize; onDisplaySize: (delta: -1 | 1) => void;
  showHidden: boolean; onShowHidden: (v: boolean) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const active = presetIdFor(sort);
  return (
    <>
      <div className="ctx-backdrop" onClick={onClose} />
      <div className="ctx-menu view-options" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4 }}>
        <div className="vo-row vo-title">Icon Size</div>
        <div className="vo-row vo-icon-size">
          <button className="btn vo-step" onClick={() => onDisplaySize(-1)} aria-label="Smaller">−</button>
          <span className="vo-size-val">{displaySize}</span>
          <button className="btn vo-step" onClick={() => onDisplaySize(1)} aria-label="Larger">+</button>
        </div>
        <div className="vo-section">Sort</div>
        {SORT_PRESETS.map((p) => (
          <div key={p.id} className="ctx-menu-item vo-option" onClick={() => { onSort(p.sort); onClose(); }}>
            <span className={`vo-radio${active === p.id ? ' on' : ''}`}>{active === p.id ? '●' : '○'}</span>
            <span>{p.label}</span>
          </div>
        ))}
        <div className="vo-sep" />
        <div className="ctx-menu-item vo-option" onClick={() => onShowHidden(!showHidden)}>
          <span className={`vo-check${showHidden ? ' on' : ''}`}>{showHidden ? '✓' : ''}</span>
          <span>Show Hidden Files</span>
        </div>
      </div>
    </>
  );
}
