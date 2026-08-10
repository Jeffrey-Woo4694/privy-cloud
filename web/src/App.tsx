import { useState } from 'react';
import { ThemeProvider, useTheme } from './theme';
import { HermesTab } from './pages/HermesTab';
import { CodingAgentTab } from './pages/CodingAgentTab';
import { PrivyCloudTab } from './pages/PrivyCloudTab';

type Tab = 'hermes' | 'coding' | 'privy';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'hermes', label: 'Hermes Agent' },
  { key: 'coding', label: 'Coding Agent' },
  { key: 'privy', label: 'Privy Cloud' },
];

function Shell() {
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
  return <ThemeProvider><Shell /></ThemeProvider>;
}
