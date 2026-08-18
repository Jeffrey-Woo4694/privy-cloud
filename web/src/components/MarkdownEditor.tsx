import { useEffect, useState } from 'react';

export function MarkdownEditor({ path, initialText, onSave }: { path: string; initialText: string; onSave: (c: string) => Promise<void> }) {
  const [content, setContent] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setContent(initialText), [path, initialText]);

  const save = async () => {
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

  return (
    <div className="editor">
      <div className="editor-title">
        <span>{path}</span>
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}</button>
      </div>
      {error && <div className="editor-error">{error}</div>}
      <textarea value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
    </div>
  );
}
