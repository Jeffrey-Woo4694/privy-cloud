import { useEffect, useRef, useState } from 'react';
import type { FileItem } from '@privy/shared';
import { api, API_BASE } from '../api';
import { getToken } from '../auth';
import { truncatedName } from '../fileDisplay';
import { editorFor } from '../fileEditor';
import { ShapeIcon } from './icons';
import { DocEditor } from './DocEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { TextFileEditor } from './TextFileEditor';
import { StructuredViewer } from './StructuredViewer';
import { CsvEditor } from './CsvEditor';
import { CodeViewer } from './CodeViewer';
import { AudioPlayer } from './AudioPlayer';
import { ArchiveInfo } from './ArchiveInfo';

// Every view can be expanded to fill the whole interface (not just the small
// sharing panel): editors, media, and read-only previews alike.
export function FileViewer({ item, onBack, onSaved, onTrash, onRename, onRefreshItems }: { item: FileItem; onBack(): void; onSaved(): void; onTrash?: (path: string) => void; onRename?: (path: string, newName: string) => Promise<void>; onRefreshItems?: () => void }) {
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
  const [actionsOpen, setActionsOpen] = useState(false);
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

  // F2 toggles fullscreen for any file view (editor, media, or preview); Esc backs
  // out one layer at a time — the actions popover first, then fullscreen, then the
  // file itself. Capture phase so it runs
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
        if (actionsOpen) { e.preventDefault(); e.stopPropagation(); setActionsOpen(false); return; }
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
  }, [expanded, actionsOpen]);

  useEffect(() => {
    if (mode === 'text' || mode === 'structured' || mode === 'markdown' || mode === 'code') {
      setTextLoaded(false);
      api.getFileText(item.path).then(setText).finally(() => setTextLoaded(true));
    }
  }, [item.path, mode]);

  // A new item — or a media source that just flipped (transcode finished: pending →
  // proxy ready) — starts from a clean element: old failures and reload keys reset.
  useEffect(() => { setVideoFailed(false); setImageFailed(false); setVideoReload(0); setImageReload(0); setActionsOpen(false); },
    [item.path, item.hasProxy, item.proxyPending]);

  // Re-opening a different file resets the CSV grid fallback.
  useEffect(() => { setCsvGrid(false); setCsvText(''); }, [item.path]);

  // Fetch the CSV text on demand so the byte-faithful grid editor can open.
  const openCsvGrid = async () => {
    try { setCsvText(await api.getFileText(item.path)); setCsvGrid(true); }
    catch { /* leave the OnlyOffice editor open */ }
  };

  // Every right-side action lives in one ▾ popover (same affordance as the main
  // sharing page's Create button), so the top bar leaves room for the file name.
  const actionsMenu = actionsOpen && (
    <>
      <div className="ctx-backdrop" onClick={() => setActionsOpen(false)} />
      <div className="ctx-menu viewer-actions" role="menu" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4 }}>
        {!item.isDir && (
          <a role="menuitem" className="ctx-menu-item" href={url} download={item.name} onClick={() => setActionsOpen(false)}
            title="Download this file">
            <span className="ctx-menu-icon"><ShapeIcon name="download" size={14} /></span>Download
          </a>
        )}
        <div role="menuitem" className="ctx-menu-item" onClick={() => { setExpanded((e) => !e); setActionsOpen(false); }}>
          <span className="ctx-menu-icon"><ShapeIcon name={expanded ? 'compress' : 'expand'} size={14} /></span>
          {expanded ? 'Exit fullscreen' : 'Expand'}
        </div>
        {isCsv && !csvGrid && (
          <div role="menuitem" className="ctx-menu-item" onClick={() => { setActionsOpen(false); void openCsvGrid(); }}
            title="Edit as a byte-faithful grid (preserves quoting & line-endings)">
            <span className="ctx-menu-icon"><ShapeIcon name="eye" size={14} /></span>Open as grid
          </div>
        )}
        {onTrash && (
          <div role="menuitem" className="ctx-menu-item danger" onClick={() => { setActionsOpen(false); onTrash(item.path); }}>
            <span className="ctx-menu-icon"><ShapeIcon name="trash" size={14} /></span>Trash
          </div>
        )}
      </div>
    </>
  );

  return (
    <div ref={rootRef} className={expanded ? 'viewer viewer-fullscreen' : 'viewer'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <button className="btn" onClick={onBack} title="Back to sharing"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ShapeIcon name="back" size={15} /> Back
        </button>
        <span className="viewer-bar-name" title={item.name}>{truncatedName(item.name, item.isDir)}</span>
        <span style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <button className="btn" onClick={() => setActionsOpen((o) => !o)} aria-label="File actions" aria-expanded={actionsOpen}
            title="File actions"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, padding: '6px 12px' }}>
            <ShapeIcon name="chevronDown" size={16} />
          </button>
          {actionsMenu}
        </div>
      </div>
      {mode === 'markdown' && textLoaded && (
        <MarkdownEditor name={item.name} initialText={text}
          onSave={async (c) => { await api.saveFileText(item.path, c); onSaved(); }}
          onRename={onRename && (async (n) => { await onRename(item.path, n); })} />
      )}
      {mode === 'text' && textLoaded && (
        <TextFileEditor name={item.name} initialText={text}
          onSave={async (c) => { await api.saveFileText(item.path, c); onSaved(); }}
          onRename={onRename && (async (n) => { await onRename(item.path, n); })} />
      )}
      {mode === 'structured' && textLoaded && (editingText
        ? <TextFileEditor name={item.name} initialText={text} onSave={async (c) => { await api.saveFileText(item.path, c); onSaved(); setEditingText(false); }} onRename={onRename && (async (n) => { await onRename(item.path, n); })} />
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
              <p>Preview unavailable. Use "Download" in the file-actions menu.</p>
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
              <p>Preview unavailable for this video. Use "Download" in the file-actions menu.</p>
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
