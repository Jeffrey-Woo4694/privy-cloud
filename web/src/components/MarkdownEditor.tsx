import { useEffect, useState } from 'react';
import { Markdown } from './Markdown';
import { FileNameInput } from './FileNameInput';
import { useEditorSave } from '../useEditorSave';

/** Markdown file surface — one component for both faces of the file. It opens on
 *  the rendered design; the head row's single Edit/Show button swaps the body
 *  between the formatted view and the raw markdown source (the button's label is
 *  all that changes — its size stays still, so the row never shifts). The head
 *  matches the plain-text editor: editable file name (no parent directory), a
 *  fixed "Save" button, and ghost status text beside it for the save reaction.
 *  Raw edits autosave ~1.2s after the last keystroke; unmount flushes a pending
 *  edit, so switching to Show (or Esc) never drops work. */
export function MarkdownEditor({ name, initialText, onSave, onRename }: {
  name: string; initialText: string;
  onSave: (c: string) => Promise<void>;
  onRename?: (newName: string) => Promise<void>;
}) {
  const [content, setContent] = useState(initialText);
  const [editing, setEditing] = useState(false); // false = rendered design, true = raw source
  const { save, scheduleSave, markSaved, saving, status, error, dirty } = useEditorSave(content, onSave);

  // Same async-load re-sync as TextFileEditor: pick up text that lands after
  // mount, and treat it as the saved baseline.
  useEffect(() => { setContent(initialText); markSaved(initialText); }, [initialText]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush a pending edit under the old path before the move, so a rename can't
  // race (or lose) the autosave.
  const commitRename = async (newName: string) => {
    if (dirty) await save();
    await onRename?.(newName);
  };

  return (
    <div className="editor">
      <div className="editor-title">
        <button type="button" className="btn md-toggle" onClick={() => setEditing((v) => !v)} aria-pressed={editing}
          title={editing ? 'Show the rendered markdown' : 'Edit the raw markdown'}>
          {editing ? 'Show' : 'Edit'}
        </button>
        <FileNameInput name={name} onRename={onRename ? commitRename : undefined} />
        <span className="save-ghost" aria-live="polite">{status}</span>
        <button className="btn primary" onClick={() => void save()} disabled={saving} title="Ctrl+S">Save</button>
      </div>
      {error && <div className="editor-error">{error}</div>}
      {editing ? (
        <textarea value={content} onChange={(e) => { setContent(e.target.value); scheduleSave(); }} spellCheck={false} />
      ) : (
        <div className="markdown md-body"><Markdown>{content}</Markdown></div>
      )}
    </div>
  );
}
