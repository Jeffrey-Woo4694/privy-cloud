import { useState } from 'react';

export function LoginGate({ onLogin, error, busy }: { onLogin: (token: string) => void; error?: string; busy?: boolean }) {
  const [token, setTok] = useState('');
  const [show, setShow] = useState(false);
  return (
    <div className="placeholder-page">
      <div style={{ fontSize: 40 }}>🔑</div>
      <div style={{ fontSize: 18 }}>Enter your Privy Cloud access token</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
        <input placeholder="Access token" type={show ? 'text' : 'password'} value={token}
          onChange={(e) => setTok(e.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          style={{ flex: 1, minWidth: 0, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--inputbg)', color: 'var(--text)' }} />
        <button aria-label={show ? 'Hide token' : 'Show token'} title={show ? 'Hide token' : 'Show token'}
          className="btn" onClick={() => setShow(s => !s)}
          style={{ color: show ? 'var(--accent)' : 'var(--muted)', padding: '8px 12px' }}>
          {show ? '🙈' : '👁️'}
        </button>
      </div>
      {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
      <button className="btn primary" onClick={() => onLogin(token)} disabled={busy}>{busy ? 'Checking…' : 'Unlock'}</button>
      <div style={{ color: 'var(--muted)', fontSize: 12 }}>Token is in ~/.privy-cloud/config.json</div>
    </div>
  );
}
