import { useState } from 'react';
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

export function App() {
  const [authed, setAuthed] = useState(() => !!getToken());
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const handleLogin = async (token: string) => {
    setLoginError('');
    setLoggingIn(true);
    setToken(token); // so api.ts sends it
    try {
      await api.getMeta(); // server validates the token
      setAuthed(true);
    } catch {
      clearToken();
      setLoginError('Invalid access token');
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <ThemeProvider>
      {authed
        ? <Shell onLogout={() => { clearToken(); setAuthed(false); }} />
        : <LoginGate onLogin={(t) => void handleLogin(t)} error={loginError} busy={loggingIn} />}
    </ThemeProvider>
  );
}
