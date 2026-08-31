import { useEffect, useRef, useState } from 'react';
import type { FileItem } from '@privy/shared';
import { api, API_BASE } from '../api';
import { getToken } from '../auth';
import { editorFor } from '../fileEditor';
import { ShapeIcon } from './icons';
import { DocEditor } from './DocEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownViewer } from './MarkdownViewer';
import { TextFileEditor } from './TextFileEditor';
import { StructuredViewer } from './StructuredViewer';
import { CsvEditor } from './CsvEditor';
import { CodeViewer } from './CodeViewer';
import { AudioPlayer } from './AudioPlayer';
import { ArchiveInfo } from './ArchiveInfo';

// Every view can be expanded to fill the whole interface (not just the small
// sharing panel): editors, media, and read-only previews alike.
export function FileViewer({ item, onBack, onSaved, onTrash, onRefreshItems }: { item: FileItem; onBack(): void; onSaved(): void; onTrash?: (path: string) => void; onRefreshItems?: () => void }) {
  const url = `${API_BASE}/api/file?path=${encodeURIComponent(item.path)}&token=${encodeURIComponent(getToken() ?? '')}`;
  const [text, setText] = useState('');
  const [videoFailed, setVideoFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  // Bumping a reload key remounts the <video>/<img> element — a failed load
  // (transient network drop, interrupted Range request) then retries from a
  // clean element instead of staying a sticky dead end.
  const [videoReload, setVideoReload] = useState(0);
  const [imageReload, setImageReload] = useState(0);
  const [editingText, setEditingText] = useState(false);
  const [textLoaded, setTextLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [csvGrid, setCsvGrid] = useState(false); // byte-faithful CSV grid fallback (vs. OnlyOffice)
  const [csvText, setCsvText] = useState('');
  const mode = editorFor(item.name);
  const isCsv = mode === 'office' && /\.csv$/i.test(item.name);

  // The embedded editors (OnlyOffice, textarea) size to their container and only
  // re-measure on a window resize. Grow/shrink happens via the container's CSS, so
  // nudge a resize so a fullscreen toggle reflows the editor to fill the frame (and
  // collapses back). Harmless for viewers that don't listen.
  useEffect(() => { window.dispatchEvent(new Event('resize')); }, [expanded]);

  // While a media preview is still transcoding server-side, re-poll the listing so
  // the parent can hand this viewer the item once hasProxy flips true (which then
  // stops the interval via the proxyPending dep).
  useEffect(() => {
    if (!item.proxyPending || !onRefreshItems) return;
    const id = setInterval(() => onRefreshItems(), 3000);
    return () => clearInterval(id);
  }, [item.proxyPending, onRefreshItems]);

  // F2 toggles fullscreen for any file view (editor, media, or preview); Esc exits
  // fullscreen first, then closes the file back to the grid. Capture phase so it runs
  // before other handlers. (Keys while focus is inside the cross-origin
  // OnlyOffice iframe do NOT reach this parent window — there the editor's own F2/Esc win,
  // and the on-screen Expand/Exit button is the reliable path. Esc inside our own
  // editors is safe to honour: every edit autosaves (and flushes on unmount).)
  const onBackRef = useRef(onBack);
  useEffect(() => { onBackRef.current = onBack; });
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault(); setExpanded((v) => !v);
      } else if (e.key === 'Escape') {
        const t = e.target as HTMLElement | null;
        const editable = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        // Editable field OUTSIDE the viewer (chat box, dialogs) — its own handler owns Esc.
        if (editable && !(rootRef.current && t && rootRef.current.contains(t))) return;
        e.preventDefault();
        // Consume the keystroke: this listener is capture-phase on window, and without
        // stopping it the same Escape also reaches the grid's bubble-phase shortcut in
        // PrivyCloudTab, which pops the browse path a directory above the file.
        e.stopPropagation();
        if (expanded) setExpanded(false);
        else onBackRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [expanded]);

  useEffect(() => {
    if (mode === 'text' || mode === 'structured' || mode === 'markdown' || mode === 'code') {
      setTextLoaded(false);
      api.getFileText(item.path).then(setText).finally(() => setTextLoaded(true));
    }
  }, [item.path, mode]);

  // A new item — or a media source that just flipped (transcode finished: pending →
  // proxy ready) — starts from a clean element: old failures and reload keys reset.
  useEffect(() => { setVideoFailed(false); setImageFailed(false); setVideoReload(0); setImageReload(0); },
    [item.path, item.hasProxy, item.proxyPending]);

  // Re-opening a different file resets the CSV grid fallback.
  useEffect(() => { setCsvGrid(false); setCsvText(''); }, [item.path]);

  // Fetch the CSV text on demand so the byte-faithful grid editor can open.
  const openCsvGrid = async () => {
    try { setCsvText(await api.getFileText(item.path)); setCsvGrid(true); }
    catch { /* leave the OnlyOffice editor open */ }
  };

  return (
    <div ref={rootRef} className={expanded ? 'viewer viewer-fullscreen' : 'viewer'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <button className="btn" onClick={onBack} title="Back to sharing"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ShapeIcon name="back" size={15} /> Back
        </button>
        <span style={{ fontWeight: 600 }}>{item.name}</span>
        <span style={{ flex: 1 }} />
        {(item.kind === 'video' || item.kind === 'image') && <a className="btn" href={url} download={item.name}>Download original</a>}
        <button className="btn" onClick={() => setExpanded((e) => !e)} aria-pressed={expanded}
          title={expanded ? 'Exit fullscreen' : 'Expand to fullscreen (F2)'}>
          {expanded ? '⤢ Exit fullscreen' : '⛶ Expand'}
        </button>
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
              <button className="btn" onClick={() => { setImageFailed(false); setImageReload((n) => n + 1); }}>Retry</button>
            </div>
          ) : (
            <img key={imageReload} src={item.hasProxy ? api.proxyUrl(item.path) : url} alt={item.name} onError={() => setImageFailed(true)} />
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
              <button className="btn" onClick={() => { setVideoFailed(false); setVideoReload((n) => n + 1); }}>Retry</button>
            </div>
          ) : (
            <video key={videoReload} src={item.hasProxy ? api.proxyUrl(item.path) : url} controls onError={() => setVideoFailed(true)} />
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
