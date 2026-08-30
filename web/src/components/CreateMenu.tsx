import { useEffect } from 'react';
import type { CreateKind } from './CreateDialog';
import { ShapeIcon } from './icons';

/** The "create" popover opened from the trailing ▾ button: shows New Folder /
 *  New File as actions. Selecting one closes it and opens the naming dialog. */
export function CreateMenu({ open, onClose, onPick }: {
  open: boolean; onClose: () => void; onPick: (kind: CreateKind) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="ctx-backdrop" onClick={onClose} />
      <div className="ctx-menu" role="menu" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4 }}>
        <div role="menuitem" className="ctx-menu-item" onClick={() => onPick('folder')}>
          <span className="ctx-menu-icon"><ShapeIcon name="folderPlus" size={14} /></span>New Folder
        </div>
        <div role="menuitem" className="ctx-menu-item" onClick={() => onPick('file')}>
          <span className="ctx-menu-icon"><ShapeIcon name="filePlus" size={14} /></span>New File
        </div>
      </div>
    </>
  );
}
