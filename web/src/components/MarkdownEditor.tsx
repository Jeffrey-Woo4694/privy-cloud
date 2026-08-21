import { useEffect, useRef, useState } from 'react';

export function MarkdownEditor({ path, initialText, onSave }: { path: string; initialText: string; onSave: (c: string) => Promise<void> }) {
  const [content, setContent] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setContent(initialText), [path, initialText]);

  const save = async () => {
    if (saving) return; // ignore repeats (button is disabled while saving; shortcut too)
    setSaving(true);
    setError('');
    try {
      await onSave(content);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError((e as Error).message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // Keep the latest save in a ref so the Ctrl+S listener below always calls the
  // current closure (with the freshest content), without re-attaching per render.
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });

  // Ctrl+S / Cmd+S saves the file and prevents the browser's default "Save Page".
  // Attached at the window so it works wherever focus is inside the editor, and
  // removed on unmount so it never leaks beyond this view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="editor">
      <div className="editor-title">
        <span>{path}</span>
        <button className="btn primary" onClick={save} disabled={saving} title="Ctrl+S">{saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}</button>
      </div>
      {error && <div className="editor-error">{error}</div>}
      <textarea value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
    </div>
  );
}
