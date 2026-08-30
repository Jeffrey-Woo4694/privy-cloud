import { useEffect, useRef, useState } from 'react';

export type CreateKind = 'folder' | 'file';

/** Modal for creating a folder/file by name — replaces the inline name box that used
 *  to sit in the toolbar. Enter submits, Escape or the backdrop/✕ cancels, and the
 *  input is focused on open. The submitted name is trimmed and non-empty validated. */
export function CreateDialog({ kind, onConfirm, onCancel }: { kind: CreateKind; onConfirm: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = () => {
    const v = name.trim();
    if (v) onConfirm(v);
  };

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="create-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="create-dialog-head">
          <span className="create-dialog-title">{kind === 'folder' ? 'New Folder' : 'New File'}</span>
          <button className="create-dialog-close" onClick={onCancel} aria-label="Close">✕</button>
        </div>
        <input className="create-dialog-input" ref={inputRef} value={name} autoFocus
          placeholder={kind === 'folder' ? 'Folder Name' : 'File Name'}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); else if (e.key === 'Escape') onCancel(); }} />
        <div className="create-dialog-actions">
          <button className="btn btn-primary" onClick={submit} disabled={!name.trim()}>Create</button>
        </div>
      </div>
    </div>
  );
}
