import { useEffect, useState } from 'react';
import { ThemeProvider, useTheme } from './theme';
import { useMediaQuery } from './useMediaQuery';
import { LoginGate } from './components/LoginGate';
import { HermesTab } from './pages/HermesTab';
import { CodingAgentTab } from './pages/CodingAgentTab';
import { PrivyCloudTab } from './pages/PrivyCloudTab';
import { getToken, setToken, clearToken } from './auth';
import { api } from './api';
import { useIdleScroll } from './useIdleScroll';
import { TaiChiIcon } from './components/icons';

type Tab = 'hermes' | 'coding' | 'privy';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'hermes', label: 'Hermes Agent' },
  { key: 'coding', label: 'Coding Agent' },
  { key: 'privy', label: 'Privy Cloud' },
];

/// Mobile drawer destinations. On phones the top tab bar is replaced by a ☰ that
/// slides in this drawer; "Privy Cloud" is presented as "Shared files".
const MOBILE_TABS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: 'hermes', label: 'Hermes Agent', icon: '🤖' },
  { key: 'coding', label: 'Coding Agent', icon: '👨‍💻' },
  { key: 'privy', label: 'Shared files', icon: '📁' },
];

function Shell({ onLogout }: { onLogout(): void }) {
  // The default view is Privy Cloud (the file-sharing + Hermes chat), for every
  // entry point — desktop shell, browser web, and phone web.
  const [tab, setTab] = useState<Tab>('privy');
  const { theme, toggle } = useTheme();
  const isMobile = useMediaQuery('(max-width: 820px)');
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Leaving mobile (e.g. rotating to a wide window) should not leave a stuck drawer.
  useEffect(() => { if (!isMobile) setDrawerOpen(false); }, [isMobile]);

  const selectTab = (t: Tab) => { setTab(t); setDrawerOpen(false); };
  const label = (t: Tab) => TABS.find((x) => x.key === t)!.label;

  const body = (
    <div className="app-body">
      {tab === 'hermes' && <HermesTab />}
      {tab === 'coding' && <CodingAgentTab />}
      {tab === 'privy' && <PrivyCloudTab />}
    </div>
  );

  if (isMobile) {
    return (
      <div className="mobile-shell">
        <div className={`mobile-content${drawerOpen ? ' open' : ''}`}>
          <div className="mobile-topbar">
            <button className="btn mobile-menu" aria-label="menu" onClick={() => setDrawerOpen((v) => !v)}>☰</button>
            <button className="icon-btn" onClick={toggle} aria-label="toggle theme" title="Toggle theme"><TaiChiIcon /></button>
            <span className="mobile-title">{label(tab)}</span>
            <span style={{ flex: 1 }} />
            <button className="ghost-btn" onClick={onLogout} aria-label="logout">Logout</button>
          </div>
          {body}
        </div>
        <div className={`mobile-overlay${drawerOpen ? ' open' : ''}`} onClick={() => setDrawerOpen(false)} />
        <div className={`mobile-drawer${drawerOpen ? ' open' : ''}`}>
          <div className="mobile-drawer-title">Privy Cloud</div>
          {MOBILE_TABS.map((t) => (
            <button key={t.key} className={`mobile-drawer-item${tab === t.key ? ' active' : ''}`} onClick={() => selectTab(t.key)}>
              <span className="mobile-drawer-icon">{t.icon}</span>{t.label}
            </button>
          ))}
          <div className="mobile-drawer-divider" />
          <button className="mobile-drawer-item" onClick={onLogout}><span className="mobile-drawer-icon">🚪</span>Logout</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="tab-bar">
        <div className="tab-left">
          <button className="icon-btn" onClick={toggle} aria-label="toggle theme" title="Toggle theme"><TaiChiIcon /></button>
        </div>
        <div className="seg">
          {TABS.map((t) => (
            <button key={t.key} className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
        <div className="tab-right">
          <button className="ghost-btn" onClick={onLogout} aria-label="logout">Logout</button>
        </div>
      </div>
      {body}
    </div>
  );
}

type AuthState = 'checking' | 'authenticated' | 'unauthenticated';

export function App() {
  useIdleScroll();
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
