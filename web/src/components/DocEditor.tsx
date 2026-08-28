import { useEffect, useRef, useState } from 'react';
import { api, API_BASE } from '../api';
import { getToken } from '../auth';

export interface Session { enabled: boolean; key?: string; fileUrl?: string; callbackUrl?: string; engineUrl?: string; fileType?: string; fileExt?: string; title?: string }

declare global { interface Window { DocsAPI?: { DocEditor: new (id: string, cfg: unknown) => unknown } } }

/** Build the OnlyOffice DocEditor config from a backend office session.
 *  `document.fileType` is the file's real extension (docx/xlsx/pptx/…) — the engine
 *  rejects an editor-type tag here. The word/cell/slide kind is the *top-level*
 *  `documentType`, not a `document.*` field. */
export function buildEditorConfig(session: Session, name: string, onSaved: () => void): unknown {
  const fileType = session.fileExt ?? name.split('.').pop()?.toLowerCase() ?? 'docx';
  return {
    document: { fileType, key: session.key, title: name, url: session.fileUrl },
    documentType: session.fileType,
    editorConfig: { callbackUrl: session.callbackUrl, lang: 'en', custom: { autosave: true } },
    height: '100%', width: '100%', events: { onSave: onSaved },
    type: 'desktop',
  } as unknown;
}

export function DocEditor({ path, name, onSaved, onTrash }: { path: string; name: string; onSaved(): void; onTrash?: (p: string) => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'locked'>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [force, setForce] = useState(false);
  // The one-use office session token, held so unmount/pagehide can release the file lock.
  const tokenRef = useRef<string | undefined>(undefined);
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
    const script = document.createElement('script');
    script.src = `${session.engineUrl}/web-apps/apps/api/documents/api.js`;
    script.onload = () => {
      if (!window.DocsAPI) { setError('Editor failed to load'); return; }
      new window.DocsAPI.DocEditor('placeholder', buildEditorConfig(session, name, onSaved));
    };
    script.onerror = () => setError('Editor unavailable');
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, [state, session, name, onSaved]);

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
  return <div className="viewer-body"><div id="placeholder" style={{ width: '100%', height: '100%' }} /></div>;
}
