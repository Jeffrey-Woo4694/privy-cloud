import { useState } from 'react';
import { getToken, setToken } from '../auth';

export function LoginGate({ children }: { children: React.ReactNode }) {
  const [token, setTok] = useState(getToken() ?? '');
  const [stored, setStored] = useState<string | null>(getToken());
  if (stored) return <>{children}</>;
  return (
    <div className="placeholder-page">
      <div style={{ fontSize: 40 }}>🔑</div>
      <div style={{ fontSize: 18 }}>Enter your Privy Cloud access token</div>
      <input placeholder="Access token" value={token} onChange={(e) => setTok(e.target.value)}
        style={{ width: 300, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--inputbg)', color: 'var(--text)' }} />
      <button className="btn primary" onClick={() => { setToken(token); setStored(token); }}>Unlock</button>
    </div>
  );
}
