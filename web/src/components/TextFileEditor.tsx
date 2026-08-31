import { useEffect, useState } from 'react';
import { FileNameInput } from './FileNameInput';
import { useEditorSave } from '../useEditorSave';

/** Plain-text editor: head row with an editable name, a fixed "Save" button, and
 *  ghost status text beside it (the save reaction — "Saving…"/"Saved" — never
 *  changes the button itself). Autosaves ~1.2s after the last keystroke. */
export function TextFileEditor({ name, initialText, onSave, onRename }: {
  name: string; initialText: string;
  onSave: (c: string) => Promise<void>;
  onRename?: (newName: string) => Promise<void>;
}) {
  const [content, setContent] = useState(initialText);
  const { save, scheduleSave, markSaved, saving, status, error, dirty } = useEditorSave(content, onSave);

  // Re-sync when async-loaded text arrives: the parent fetches text on mount, so
  // initialText is '' on the first render, then fills in — the editor must pick it
  // up. A dependency on `initialText` only refires when the value actually changes
  // (the parent's `text` state is set once, not on every keystroke), so this never
  // clobbers in-progress typing. Adopting it as "saved" keeps the dedupe honest.
  useEffect(() => { setContent(initialText); markSaved(initialText); }, [initialText]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rename the file on disk: flush any unsaved edit first (under the old path),
  // then hand the new name to the parent — so the move never races the write.
  const commitRename = async (newName: string) => {
    if (dirty) await save();
    await onRename?.(newName);
  };

  return (
    <div className="editor">
      <div className="editor-title">
        <FileNameInput name={name} onRename={onRename ? commitRename : undefined} />
        <span className="save-ghost" aria-live="polite">{status}</span>
        <button className="btn primary" onClick={() => void save()} disabled={saving} title="Ctrl+S">Save</button>
      </div>
      {error && <div className="editor-error">{error}</div>}
      <textarea value={content} onChange={(e) => { setContent(e.target.value); scheduleSave(); }} spellCheck={false} style={{ fontFamily: 'monospace' }} />
    </div>
  );
}
