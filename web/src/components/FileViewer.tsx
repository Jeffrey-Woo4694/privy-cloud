import { useEffect, useState } from 'react';
import type { FileItem } from '@privy/shared';
import { api, API_BASE } from '../api';
import { MarkdownEditor } from './MarkdownEditor';

export function FileViewer({ item, onBack, onSaved }: { item: FileItem; onBack(): void; onSaved(): void }) {
  const url = `${API_BASE}/api/file?path=${encodeURIComponent(item.path)}`;
  const [text, setText] = useState('');

  useEffect(() => {
    if (item.kind === 'markdown') api.getFileText(item.path).then(setText);
  }, [item.path, item.kind]);

  return (
    <div className="viewer">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <button className="back-link" onClick={onBack}>← Back to sharing</button>
        <span style={{ fontWeight: 600 }}>{item.name}</span>
      </div>
      {item.kind === 'markdown' && (
        <MarkdownEditor path={item.path} initialText={text}
          onSave={async (c) => { await api.saveFileText(item.path, c); onSaved(); }} />
      )}
      {item.kind === 'image' && <div className="viewer-body"><img src={url} alt={item.name} /></div>}
      {item.kind === 'video' && <div className="viewer-body"><video src={url} controls /></div>}
      {item.kind === 'document' && item.name.toLowerCase().endsWith('.pdf') && (
        <div className="viewer-body"><iframe src={url} title={item.name} style={{ width: '100%', height: '100%', border: 'none' }} /></div>
      )}
      {((item.kind === 'document' && !item.name.toLowerCase().endsWith('.pdf')) || item.kind === 'slide' || item.kind === 'other') && (
        <div className="viewer-body">
          <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ fontSize: 40 }}>📄</div>
            <p>Inline preview for this type isn't ready yet.</p>
            <a className="btn" href={url} download={item.name}>Download</a>
          </div>
        </div>
      )}
      {item.kind === 'folder' && (
        <div className="viewer-body"><div style={{ color: 'var(--muted)' }}>Folders are shown in the sharing grid — browse them by opening files.</div></div>
      )}
    </div>
  );
}
