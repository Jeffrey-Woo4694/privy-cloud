import { useEffect, useState } from 'react';

export function MarkdownEditor({ path, initialText, onSave }: { path: string; initialText: string; onSave: (c: string) => Promise<void> }) {
  const [content, setContent] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => setContent(initialText), [path, initialText]);

  const save = async () => {
    setSaving(true);
    await onSave(content);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="editor">
      <div className="editor-title">
        <span>{path}</span>
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}</button>
      </div>
      <textarea value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
    </div>
  );
}
