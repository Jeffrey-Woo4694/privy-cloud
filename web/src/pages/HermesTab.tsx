import { useState } from 'react';
import { useHermes } from '../hermes/useHermes';
import type { Message, ToolCard } from '../hermes/types';

const ROLE_ICON: Record<Message['role'], string> = { user: '🧑', assistant: '🤖', steer: '🎯' };

function ToolCardView({ tool }: { tool: ToolCard }) {
  const running = tool.state === 'running';
  const failed = !running && tool.ok === false;
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)', marginTop: 4 }}
    >
      <span style={{ width: 14 }}>{running ? '…' : failed ? '✗' : '✓'}</span>
      <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>{tool.name}</span>
      {tool.preview && (
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{tool.preview}</span>
      )}
    </div>
  );
}

function MessageView({ msg }: { msg: Message }) {
  return (
    <div className="chat-entry">
      <div className="chat-icon">{ROLE_ICON[msg.role]}</div>
      <div className="chat-bubble">
        {msg.role === 'steer' && <span style={{ color: 'var(--muted)', fontSize: 11, display: 'block' }}>mid-turn steer</span>}
        {msg.text ? <span>{msg.text}</span> : msg.role === 'assistant' && msg.tools.length === 0 && <span>…</span>}
        {msg.tools.map((t) => <ToolCardView key={t.id} tool={t} />)}
      </div>
    </div>
  );
}

export function HermesTab() {
  const { state, send, stop, undo } = useHermes();
  const [text, setText] = useState('');

  // Enter always sends — `send()` itself routes to session.steer when the
  // agent is mid-turn. The Stop button (below) is the explicit interrupt path.
  const submitText = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    send(trimmed);
    setText('');
  };

  const onButtonClick = () => {
    if (state.streaming) {
      stop();
      return;
    }
    submitText();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-title">Hermes Agent</div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {state.messages.length === 0 && (
          <div className="empty-state">Ask your local Hermes agent anything.</div>
        )}
        {state.messages.map((m) => <MessageView key={m.id} msg={m} />)}
      </div>
      {state.status && <div style={{ color: 'var(--muted)', fontSize: 11, padding: '4px 2px' }}>{state.status}</div>}
      <div className="send-input">
        <input
          value={text}
          placeholder="Ask Hermes…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitText(); }}
        />
        <button className="btn" aria-label="undo" onClick={undo}>↩️</button>
        <button className="btn primary" onClick={onButtonClick}>
          {state.streaming ? 'Stop' : 'Send'}
        </button>
      </div>
    </div>
  );
}
