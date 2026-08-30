import { useEffect, useRef, useState } from 'react';
import type { FileItem } from '@privy/shared';
import { api, API_BASE } from '../api';
import { getToken } from '../auth';
import { editorFor } from '../fileEditor';
import { DocEditor } from './DocEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownViewer } from './MarkdownViewer';
import { TextFileEditor } from './TextFileEditor';
import { StructuredViewer } from './StructuredViewer';
import { CsvEditor } from './CsvEditor';
import { CodeViewer } from './CodeViewer';
import { AudioPlayer } from './AudioPlayer';
import { ArchiveInfo } from './ArchiveInfo';

// Views that render a real editing surface (as opposed to a read-only preview).
// The Expand/Exit-fullscreen toggle is offered for these so the edit surface can
// fill the whole interface instead of the small sharing panel.
const EDITABLE_MODES = new Set(['office', 'markdown', 'text', 'structured', 'code']);

export function FileViewer({ item, onBack, onSaved, onTrash }: { item: FileItem; onBack(): void; onSaved(): void; onTrash?: (path: string) => void }) {
  const url = `${API_BASE}/api/file?path=${encodeURIComponent(item.path)}&token=${encodeURIComponent(getToken() ?? '')}`;
  const [text, setText] = useState('');
  const [videoFailed, setVideoFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [editingText, setEditingText] = useState(false);
  const [textLoaded, setTextLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [csvGrid, setCsvGrid] = useState(false); // byte-faithful CSV grid fallback (vs. OnlyOffice)
  const [csvText, setCsvText] = useState('');
  const mode = editorFor(item.name);
  const isCsv = mode === 'office' && /\.csv$/i.test(item.name);
  const canExpand = EDITABLE_MODES.has(mode);

  // The embedded editors (OnlyOffice, textarea) size to their container and only
  // re-measure on a window resize. Grow/shrink happens via the container's CSS, so
  // nudge a resize so a fullscreen toggle reflows the editor to fill the frame (and
  // collapses back). Harmless for viewers that don't listen.
  useEffect(() => { window.dispatchEvent(new Event('resize')); }, [expanded]);

  // F2 toggles the editor fullscreen (editable modes only); Esc exits fullscreen first,
  // then closes the file back to the grid. Capture phase so it runs before other handlers
  // and for non-editable viewers too. (Keys while focus is inside the cross-origin
  // OnlyOffice iframe do NOT reach this parent window — there the editor's own F2/Esc win,
  // and the on-screen Expand/Exit button is the reliable path. Esc is also not stolen
  // while typing in an embedded editor, so it never discards an in-progress edit.)
  const onBackRef = useRef(onBack);
  useEffect(() => { onBackRef.current = onBack; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        if (!canExpand) return;
        e.preventDefault(); setExpanded((v) => !v);
      } else if (e.key === 'Escape') {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        if (canExpand && expanded) setExpanded(false);
        else onBackRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [canExpand, expanded]);

  useEffect(() => {
    if (mode === 'text' || mode === 'structured' || mode === 'markdown' || mode === 'code') {
      setTextLoaded(false);
      api.getFileText(item.path).then(setText).finally(() => setTextLoaded(true));
    }
  }, [item.path, mode]);

  useEffect(() => { setVideoFailed(false); setImageFailed(false); }, [item.path]);

  // Re-opening a different file resets the CSV grid fallback.
  useEffect(() => { setCsvGrid(false); setCsvText(''); }, [item.path]);

  // Fetch the CSV text on demand so the byte-faithful grid editor can open.
  const openCsvGrid = async () => {
    try { setCsvText(await api.getFileText(item.path)); setCsvGrid(true); }
    catch { /* leave the OnlyOffice editor open */ }
  };

  return (
    <div className={expanded ? 'viewer viewer-fullscreen' : 'viewer'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <button className="back-link" onClick={onBack}>← Back to sharing</button>
        <span style={{ fontWeight: 600 }}>{item.name}</span>
        <span style={{ flex: 1 }} />
        {(item.kind === 'video' || item.kind === 'image') && <a className="btn" href={url} download={item.name}>Download original</a>}
        {canExpand && (
          <button className="btn" onClick={() => setExpanded((e) => !e)} aria-pressed={expanded}
            title={expanded ? 'Exit fullscreen' : 'Expand editor'}>
            {expanded ? '⤢ Exit fullscreen' : '⛶ Expand'}
          </button>
        )}
        {isCsv && !csvGrid && <button className="btn" onClick={() => void openCsvGrid()} title="Edit as a byte-faithful grid (preserves quoting & line-endings)">Open as grid</button>}
        {onTrash && <button className="btn" onClick={() => onTrash(item.path)} title="Move to trash">🗑️ Trash</button>}
      </div>
      {mode === 'markdown' && textLoaded && (editingText
        ? <MarkdownEditor path={item.path} initialText={text} onSave={async (c) => { await api.saveFileText(item.path, c); onSaved(); setEditingText(false); }} />
        : <MarkdownViewer name={item.name} text={text} onEdit={() => setEditingText(true)} />)}
      {mode === 'text' && textLoaded && <TextFileEditor path={item.path} initialText={text} onSave={async (c) => { await api.saveFileText(item.path, c); onSaved(); }} />}
      {mode === 'structured' && textLoaded && (editingText
        ? <TextFileEditor path={item.path} initialText={text} onSave={async (c) => { await api.saveFileText(item.path, c); onSaved(); setEditingText(false); }} />
        : <StructuredViewer name={item.name} text={text} onEdit={() => setEditingText(true)} />)}
      {mode === 'code' && textLoaded && <CodeViewer name={item.name} path={item.path} text={text} onSave={async (c) => { await api.saveFileText(item.path, c); onSaved(); }} />}
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
      {mode === 'office' && (csvGrid
        ? <CsvEditor initialText={csvText} name={item.name} onSave={async (c) => { await api.saveFileText(item.path, c); onSaved(); setCsvGrid(false); }} onCancel={() => setCsvGrid(false)} />
        : <DocEditor path={item.path} name={item.name} onSaved={onSaved} onTrash={onTrash} />)}
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
