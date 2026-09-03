import { useEffect, useRef, useState } from 'react';
import { api, API_BASE } from '../api';
import { getToken } from '../auth';
import { useMediaQuery } from '../useMediaQuery';

export interface Session { enabled: boolean; key?: string; fileUrl?: string; callbackUrl?: string; engineUrl?: string; fileType?: string; fileExt?: string; title?: string }

interface DocEditorInstance { destroyEditor?: () => void }
declare global { interface Window { DocsAPI?: { DocEditor: new (id: string, cfg: unknown) => DocEditorInstance } } }

/** Build the OnlyOffice DocEditor config from a backend office session.
 *  `document.fileType` is the file's real extension (docx/xlsx/pptx/…) — the engine
 *  rejects an editor-type tag here. The word/cell/slide kind is the *top-level*
 *  `documentType`, not a `document.*` field.
 *  `type` must be told when we're on a phone. On a phone the engine mounts as a
 *  viewport-sized `position: fixed` iframe (see the pinFrame guard in the mount
 *  effect) — that mode is a phone layout, and read-only on the Community edition —
 *  while a desktop viewport gets the normal in-flow desktop editor. */
export function buildEditorConfig(session: Session, name: string, onSaved: () => void, isPhone = false): unknown {
  const fileType = session.fileExt ?? name.split('.').pop()?.toLowerCase() ?? 'docx';
  return {
    document: { fileType, key: session.key, title: name, url: session.fileUrl },
    documentType: session.fileType,
    editorConfig: { callbackUrl: session.callbackUrl, lang: 'en', customization: { autosave: true } },
    height: '100%', width: '100%', events: { onSave: onSaved },
    type: isPhone ? 'mobile' : 'desktop',
  } as unknown;
}

export function DocEditor({ path, name, onSaved, onTrash }: { path: string; name: string; onSaved(): void; onTrash?: (p: string) => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'locked'>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [force, setForce] = useState(false);
  // The one-use office session token, held so unmount/pagehide can release the file lock.
  const tokenRef = useRef<string | undefined>(undefined);
  // The live engine instance, held so unmount can destroy it (not just drop its script).
  const editorRef = useRef<DocEditorInstance | null>(null);
  // The container the engine mounts into, held so the mobile iframe pin below can
  // measure its box (and follow it) without reaching into the DOM by class name.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // The owner passes a new `onSaved` closure on every render. The engine gets a stable
  // wrapper that reads through this ref, so a save always reaches the current handler
  // without the editor's identity depending on a value that changes each render.
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);
  // Same 820px breakpoint the CSS and the shell layout use: below it the engine
  // gets its phone layout, whose fixed iframe the mount effect pins back below the
  // file-viewer bar so that bar's Back / ▾ buttons stay visible and tappable.
  const isPhone = useMediaQuery('(max-width: 820px)');
  const downloadUrl = `${API_BASE}/api/file?path=${encodeURIComponent(path)}&token=${encodeURIComponent(getToken() ?? '')}`;

  useEffect(() => {
    let cancelled = false;
    api.officeSession(path, force)
      .then((s) => { if (cancelled) return; if (s.token) tokenRef.current = s.token; setSession(s); setState(s.enabled ? 'ready' : 'unavailable'); })
      .catch((e) => {
        if (cancelled) return;
        // A stale lock is distinct from a disabled/unreachable engine: it is recoverable
        // by force-reopening, so surface it separately instead of giving up.
        setState(!force && (e as Error)?.message === 'already being edited' ? 'locked' : 'unavailable');
      });
    return () => { cancelled = true; };
  }, [path, force]);

  // Release the file lock so a reopened document isn't reported "already being edited".
  // Fired on unmount (Back to the file list) AND on `pagehide` (closing the tab/window
  // while the editor is open) — the latter otherwise strands the lock for the whole TTL.
  // The release fetch uses keepalive so it survives the unload; tokenRef is cleared on
  // the first release, so a later unmount is a no-op (never a double-release).
  useEffect(() => {
    const release = () => {
      const t = tokenRef.current;
      if (t) { tokenRef.current = undefined; void api.endOfficeSession(t); }
    };
    window.addEventListener('pagehide', release);
    return () => { window.removeEventListener('pagehide', release); release(); };
  }, []);

  useEffect(() => {
    if (state !== 'ready' || !session?.engineUrl) return;
    let disposed = false;

    // The phone editor escapes its container: api.js mounts `type:'mobile'` as an
    // iframe that is `position: fixed` and sized to 100% of the *viewport*, with no
    // top/left insets, in place of #placeholder. On a phone that iframe covers the
    // whole screen — the file-viewer bar above it (Back / name / ▾) is in the DOM but
    // invisible and untappable. Pin the fixed iframe back into the container's box
    // and follow the box when it moves (rotation, keyboard). The desktop type mounts
    // an in-flow iframe, so this is a no-op there.
    let frameObserver: ResizeObserver | null = null;
    const pinFrame = () => {
      const body = bodyRef.current;
      const frame = body?.querySelector('iframe');
      if (!body || !frame) return;
      if (window.getComputedStyle(frame).position !== 'fixed') return;
      const r = body.getBoundingClientRect();
      frame.style.top = `${r.top}px`;
      frame.style.left = `${r.left}px`;
      frame.style.width = `${r.width}px`;
      frame.style.height = `${r.height}px`;
    };

    const mount = () => {
      if (disposed) return;
      if (!window.DocsAPI) { setError('Editor failed to load'); return; }
      editorRef.current = new window.DocsAPI.DocEditor('placeholder', buildEditorConfig(session, name, () => onSavedRef.current(), isPhone));
      pinFrame();
      const body = bodyRef.current;
      if (body && typeof ResizeObserver !== 'undefined') {
        frameObserver = new ResizeObserver(() => pinFrame());
        frameObserver.observe(body);
      }
    };
    // `script.remove()` alone only drops the tag — the editor instance it created
    // stays live, and on a phone its input handling outlives the screen that owned
    // it, which is why the keyboard kept reappearing on taps after Back.
    // destroyEditor() is the engine's own teardown.
    const teardown = () => {
      disposed = true;
      frameObserver?.disconnect();
      frameObserver = null;
      const ed = editorRef.current;
      editorRef.current = null;
      try { ed?.destroyEditor?.(); } catch { /* engine already gone — nothing to release */ }
    };

    // The loader is served no-store, so re-adding the tag re-downloads it on every
    // open. Once it has run, the global it defines is all we need.
    if (window.DocsAPI) { mount(); return teardown; }

    const script = document.createElement('script');
    script.src = `${session.engineUrl}/web-apps/apps/api/documents/api.js`;
    script.onload = mount;
    script.onerror = () => setError('Editor unavailable');
    document.head.appendChild(script);
    return () => { teardown(); script.remove(); };
    // Deliberately not keyed on `onSaved`: see onSavedRef above. Rebuilding the
    // editor is reserved for changes that genuinely mean a different document or
    // a different layout (phone ↔ desktop flips `type`).
  }, [state, session, name, isPhone]);

  if (state === 'locked') {
    return (
      <div className="viewer-body">
        <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 40 }}>🔒</div>
          <p>This document is open in another window, or a previous session didn't close cleanly.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => setForce(true)}>Reopen anyway</button>
            <a className="btn" href={downloadUrl} download={name}>Download original</a>
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>Reopening disconnects the other editor and takes over this document.</div>
        </div>
        {onTrash && <button className="btn" onClick={() => onTrash(path)}>🗑️ Trash</button>}
      </div>
    );
  }
  if (state === 'unavailable') {
    return (
      <div className="viewer-body">
        <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 40 }}>📄</div>
          <p>Editor unavailable. Use "Download original".</p>
          <a className="btn" href={downloadUrl} download={name}>Download</a>
        </div>
        {onTrash && <button className="btn" onClick={() => onTrash(path)}>🗑️ Trash</button>}
      </div>
    );
  }
  if (error) return <div className="viewer-body" style={{ color: 'var(--danger)' }}>{error}</div>;
  return <div className="viewer-body" ref={bodyRef}><div id="placeholder" style={{ width: '100%', height: '100%' }} /></div>;
}
