import { useState } from 'react';

export function LoginGate({ onLogin, error, busy }: { onLogin: (token: string) => void; error?: string; busy?: boolean }) {
  const [token, setTok] = useState('');
  return (
    <div className="placeholder-page">
      <div style={{ fontSize: 40 }}>🔑</div>
      <div style={{ fontSize: 18 }}>Enter your Privy Cloud access token</div>
      <input placeholder="Access token" value={token} onChange={(e) => setTok(e.target.value)}
        style={{ width: 300, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--inputbg)', color: 'var(--text)' }} />
      {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
      <button className="btn primary" onClick={() => onLogin(token)} disabled={busy}>{busy ? 'Checking…' : 'Unlock'}</button>
      <div style={{ color: 'var(--muted)', fontSize: 12 }}>Token is in ~/.privy-cloud/config.json</div>
    </div>
  );
}
