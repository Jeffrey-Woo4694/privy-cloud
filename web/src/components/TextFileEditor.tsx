import { useEffect, useRef, useState } from 'react';

export function TextFileEditor({ path, initialText, onSave }: { path: string; initialText: string; onSave: (c: string) => Promise<void> }) {
  const [content, setContent] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Re-sync when async-loaded text arrives: the parent fetches text on mount, so
  // initialText is '' on the first render, then fills in — the editor must pick it
  // up. A dependency on `initialText` only refires when the value actually changes
  // (the parent's `text` state is set once, not on every keystroke), so this never
  // clobbers in-progress typing.
  useEffect(() => { setContent(initialText); }, [initialText]);

  const save = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try { await onSave(content); setSaved(true); setTimeout(() => setSaved(false), 1500); }
    catch (e) { setError((e as Error).message || 'Save failed'); }
    finally { setSaving(false); }
  };
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveRef.current(); }
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
      <textarea value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} style={{ fontFamily: 'monospace' }} />
    </div>
  );
}
