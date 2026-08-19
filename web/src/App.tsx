import { useEffect, useState } from 'react';
import { ThemeProvider, useTheme } from './theme';
import { LoginGate } from './components/LoginGate';
import { HermesTab } from './pages/HermesTab';
import { CodingAgentTab } from './pages/CodingAgentTab';
import { PrivyCloudTab } from './pages/PrivyCloudTab';
import { getToken, setToken, clearToken } from './auth';
import { api } from './api';

type Tab = 'hermes' | 'coding' | 'privy';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'hermes', label: 'Hermes Agent' },
  { key: 'coding', label: 'Coding Agent' },
  { key: 'privy', label: 'Privy Cloud' },
];

function Shell({ onLogout }: { onLogout(): void }) {
  const [tab, setTab] = useState<Tab>('hermes');
  const { theme, toggle } = useTheme();
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="tab-bar">
        {TABS.map((t) => (
          <button key={t.key} className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
        <span className="tab-spacer" />
        <button className="tab" onClick={toggle} aria-label="toggle theme">{theme === 'dark' ? '🌙' : '☀️'}</button>
        <button className="tab" onClick={onLogout} aria-label="logout">Logout</button>
      </div>
      <div className="app-body">
        {tab === 'hermes' && <HermesTab />}
        {tab === 'coding' && <CodingAgentTab />}
        {tab === 'privy' && <PrivyCloudTab />}
      </div>
    </div>
  );
}

type AuthState = 'checking' | 'authenticated' | 'unauthenticated';

export function App() {
  // A stored token is validated against the server on load, so a stale/revoked
  // token (e.g. after a token change on another device) drops back to the gate
  // instead of opening a UI whose every request 401s.
  const [auth, setAuth] = useState<AuthState>(() => (getToken() ? 'checking' : 'unauthenticated'));
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    if (auth !== 'checking') return;
    let cancelled = false;
    api
      .getMeta()
      .then(() => { if (!cancelled) setAuth('authenticated'); })
      .catch(() => { clearToken(); if (!cancelled) setAuth('unauthenticated'); });
    return () => { cancelled = true; };
  }, [auth]);

  const handleLogin = async (token: string) => {
    setLoginError('');
    setLoggingIn(true);
    setToken(token); // so api.ts sends it
    try {
      await api.getMeta(); // server validates the token
      setAuth('authenticated');
    } catch {
      clearToken();
      setLoginError('Invalid access token');
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <ThemeProvider>
      {auth === 'checking' && (
        <div className="placeholder-page"><div style={{ color: 'var(--muted)' }}>Checking…</div></div>
      )}
      {auth === 'authenticated' && <Shell onLogout={() => { clearToken(); setAuth('unauthenticated'); }} />}
      {auth === 'unauthenticated' && <LoginGate onLogin={(t) => void handleLogin(t)} error={loginError} busy={loggingIn} />}
    </ThemeProvider>
  );
}
