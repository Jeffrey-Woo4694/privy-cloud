import { useEffect, useState } from 'react';
import type { FileItem } from '@privy/shared';
import { api, API_BASE } from '../api';
import { getToken } from '../auth';
import { editorFor } from '../fileEditor';
import { DocEditor } from './DocEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { TextFileEditor } from './TextFileEditor';
import { StructuredViewer } from './StructuredViewer';
import { AudioPlayer } from './AudioPlayer';
import { ArchiveInfo } from './ArchiveInfo';

export function FileViewer({ item, onBack, onSaved, onTrash }: { item: FileItem; onBack(): void; onSaved(): void; onTrash?: (path: string) => void }) {
  const url = `${API_BASE}/api/file?path=${encodeURIComponent(item.path)}&token=${encodeURIComponent(getToken() ?? '')}`;
  const [text, setText] = useState('');
  const [videoFailed, setVideoFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [editingText, setEditingText] = useState(false);
  const [textLoaded, setTextLoaded] = useState(false);
  const mode = editorFor(item.name);

  useEffect(() => {
    if (mode === 'text' || mode === 'structured' || mode === 'markdown') {
      setTextLoaded(false);
      api.getFileText(item.path).then(setText).finally(() => setTextLoaded(true));
    }
  }, [item.path, mode]);

  useEffect(() => { setVideoFailed(false); setImageFailed(false); }, [item.path]);

  return (
    <div className="viewer">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <button className="back-link" onClick={onBack}>← Back to sharing</button>
        <span style={{ fontWeight: 600 }}>{item.name}</span>
        <span style={{ flex: 1 }} />
        {(item.kind === 'video' || item.kind === 'image') && <a className="btn" href={url} download={item.name}>Download original</a>}
        {onTrash && <button className="btn" onClick={() => onTrash(item.path)} title="Move to trash">🗑️ Trash</button>}
      </div>
      {mode === 'markdown' && textLoaded && <MarkdownEditor path={item.path} initialText={text} onSave={async (c) => { await api.saveFileText(item.path, c); onSaved(); }} />}
      {mode === 'text' && textLoaded && <TextFileEditor path={item.path} initialText={text} onSave={async (c) => { await api.saveFileText(item.path, c); onSaved(); }} />}
      {mode === 'structured' && textLoaded && (editingText
        ? <TextFileEditor path={item.path} initialText={text} onSave={async (c) => { await api.saveFileText(item.path, c); onSaved(); setEditingText(false); }} />
        : <StructuredViewer name={item.name} text={text} onEdit={() => setEditingText(true)} />)}
      {item.kind === 'image' && (
        <div className="viewer-body">
          {item.proxyPending ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
              <div style={{ fontSize: 40 }}>⏳</div>
              <p>Preparing preview…</p>
            </div>
          ) : imageFailed ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
              <div style={{ fontSize: 40 }}>🖼️</div>
              <p>Preview unavailable. Use "Download original".</p>
            </div>
          ) : (
            <img src={item.hasProxy ? api.proxyUrl(item.path) : url} alt={item.name} onError={() => setImageFailed(true)} />
          )}
        </div>
      )}
      {item.kind === 'video' && (
        <div className="viewer-body">
          {item.proxyPending ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
              <div style={{ fontSize: 40 }}>⏳</div>
              <p>Transcoding for preview…</p>
            </div>
          ) : videoFailed ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
              <div style={{ fontSize: 40 }}>🎬</div>
              <p>Preview unavailable for this video. Use "Download original".</p>
            </div>
          ) : (
            <video src={item.hasProxy ? api.proxyUrl(item.path) : url} controls onError={() => setVideoFailed(true)} />
          )}
        </div>
      )}
      {mode === 'audio' && <AudioPlayer path={item.path} name={item.name} />}
      {mode === 'archive' && <ArchiveInfo item={item} />}
      {mode === 'pdf' && <div className="viewer-body"><iframe src={url} title={item.name} style={{ width: '100%', height: '100%', border: 'none' }} /></div>}
      {mode === 'office' && <DocEditor path={item.path} name={item.name} onSaved={onSaved} onTrash={onTrash} />}
      {mode === 'none' && item.kind !== 'image' && item.kind !== 'video' && item.kind !== 'folder' && (
        <div className="viewer-body">
          <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ fontSize: 40 }}>📄</div>
            <p>Inline preview for this type isn't ready yet.</p>
            <a className="btn" href={url} download={item.name}>Download</a>
          </div>
        </div>
      )}
      {item.kind === 'folder' && <div className="viewer-body"><div style={{ color: 'var(--muted)' }}>Folders are shown in the sharing grid — browse them by opening files.</div></div>}
    </div>
  );
}
