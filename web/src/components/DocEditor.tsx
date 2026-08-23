import { useEffect, useState } from 'react';
import { api, API_BASE } from '../api';
import { getToken } from '../auth';

interface Session { enabled: boolean; token?: string; key?: string; fileUrl?: string; callbackUrl?: string; engineUrl?: string; fileType?: string; title?: string }

declare global { interface Window { DocsAPI?: { DocEditor: new (id: string, cfg: unknown) => unknown } } }

export function DocEditor({ path, name, onSaved, onTrash }: { path: string; name: string; onSaved(): void; onTrash?: (p: string) => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.officeSession(path)
      .then((s) => { if (cancelled) return; setSession(s); setState(s.enabled ? 'ready' : 'unavailable'); })
      .catch(() => !cancelled && setState('unavailable'));
    return () => { cancelled = true; };
  }, [path]);

  useEffect(() => {
    if (state !== 'ready' || !session?.engineUrl) return;
    const script = document.createElement('script');
    script.src = `${session.engineUrl}/web-apps/apps/api/documents/api.js`;
    script.onload = () => {
      // fileType comes straight from the session (the backend's officeFileType),
      // not a DOM attribute. OnlyOffice needs to know word/cell/slide upfront.
      const fileType = (session.fileType as 'word' | 'cell' | 'slide' | undefined) ?? 'word';
      if (!window.DocsAPI) { setError('Editor failed to load'); return; }
      new window.DocsAPI.DocEditor('placeholder', {
        document: { fileType, key: session.key, title: name, url: session.fileUrl },
        editorConfig: { callbackUrl: session.callbackUrl, lang: 'en', custom: { autosave: true } },
        height: '100%', width: '100%', events: { onSave: () => onSaved() },
        type: 'desktop', token: session.token,
      } as unknown);
    };
    script.onerror = () => setError('Editor unavailable');
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, [state, session]);

  if (state === 'unavailable') {
    return (
      <div className="viewer-body">
        <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 40 }}>📄</div>
          <p>Editor unavailable. Use "Download original".</p>
          <a className="btn" href={`${API_BASE}/api/file?path=${encodeURIComponent(path)}&token=${encodeURIComponent(getToken() ?? '')}`} download={name}>Download</a>
        </div>
        {onTrash && <button className="btn" onClick={() => onTrash(path)}>🗑️ Trash</button>}
      </div>
    );
  }
  if (error) return <div className="viewer-body" style={{ color: 'var(--danger)' }}>{error}</div>;
  return <div className="viewer-body"><div id="placeholder" style={{ width: '100%', height: '100%' }} /></div>;
}
