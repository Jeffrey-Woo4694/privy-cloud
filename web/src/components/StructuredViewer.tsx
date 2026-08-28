import React from 'react';

export function StructuredViewer({ name, text, onEdit }: { name: string; text: string; onEdit: () => void }) {
  const lower = name.toLowerCase();
  let body: React.ReactNode = <pre>{text}</pre>;
  if (lower.endsWith('.json')) {
    try { body = <pre>{JSON.stringify(JSON.parse(text), null, 2)}</pre>; } catch { body = <pre>{text}</pre>; }
  } else if (lower.endsWith('.xml')) {
    try { const doc = new DOMParser().parseFromString(text, 'application/xml'); body = <pre>{doc.documentElement.outerHTML.replace(/></g, '>\n<')}</pre>; } catch { body = <pre>{text}</pre>; }
  }
  return (
    <div className="viewer-body">
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button className="btn" onClick={onEdit}>Edit as text</button>
      </div>
      <div className="structured scroll">{body}</div>
    </div>
  );
}
