import { memo, useEffect, useRef, useState } from 'react';
import { useHermes } from '../hermes/useHermes';
import { useMediaQuery } from '../useMediaQuery';
import { api } from '../api';
import { Markdown } from '../components/Markdown';
import { HermesModelPicker } from '../components/HermesModelPicker';
import { HermesApprovalDialog } from '../components/HermesApprovalDialog';
import { HermesClarifyDialog } from '../components/HermesClarifyDialog';
import { HermesProcessStrip } from '../components/HermesProcessStrip';
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
      {tool.duration != null && <span style={{ opacity: 0.7 }}>{tool.duration.toFixed(1)}s</span>}
      {tool.resultPreview && (
        <span style={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{tool.resultPreview}</span>
      )}
    </div>
  );
}

const MemoToolCardView = memo(ToolCardView);

/// Download `content` as `<title>-<YYYY-MM-DD>.md`. Guarded so it no-ops where
/// `URL.createObjectURL` is unavailable (jsdom), keeping the Archive action
/// testable by asserting the `session.history` RPC instead.
function downloadArchive(title: string, content: string) {
  if (typeof URL.createObjectURL !== 'function') return;
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title || 'hermes-session'}-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function MessageView({ msg }: { msg: Message }) {
  return (
    <div className="chat-entry">
      <div className="chat-icon">{ROLE_ICON[msg.role]}</div>
      <div className="chat-bubble">
        {msg.role === 'steer' && <span style={{ color: 'var(--muted)', fontSize: 11, display: 'block' }}>mid-turn steer</span>}
        {msg.text && (msg.role === 'assistant'
          ? <Markdown>{msg.text}</Markdown>
          : <span>{msg.text}</span>)}
        {!msg.text && msg.role === 'assistant' && msg.tools.length === 0 && <span>…</span>}
        {msg.tools.map((t) => <MemoToolCardView key={t.id} tool={t} />)}
        <HermesProcessStrip msg={msg} />
      </div>
    </div>
  );
}

const MemoMessageView = memo(MessageView);

export function HermesTab() {
  const { state, send, stop, undo, sessions, newSession, resume, setModel, setEffort, respondApproval, respondClarify, attachImage, attachFile, removeAttachment, archive, rename, remove, mostRecent } = useHermes();
  const [text, setText] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [slashItems, setSlashItems] = useState<{ text: string }[]>([]);
  // On mobile hide the session sidebar so the chat fills the small screen
  // (session switching remains on the desktop layout for now).
  const isMobile = useMediaQuery('(max-width: 820px)');

  // Slash-command autocomplete: while the composer starts with `/`, debounce a
  // `complete.slash` call and render suggestions. The `send` bridge already
  // routes a leading `/` to `slash.exec` on submit.
  useEffect(() => {
    const t = text.trim();
    if (!t.startsWith('/')) {
      setSlashItems([]);
      return;
    }
    const handle = setTimeout(() => {
      api
        .hermesCall('complete.slash', { text: t })
        .then((r) => {
          const items = ((r ?? {}) as { items?: Array<{ text?: unknown }> }).items ?? [];
          setSlashItems(items.map((i) => ({ text: String(i.text ?? '') })).filter((i) => i.text));
        })
        .catch(() => setSlashItems([]));
    }, 150);
    return () => clearTimeout(handle);
  }, [text]);

  // The current session is the row whose durable key (or live id) matches
  // `state.sessionKey` — the id `session.list` keys entries by.
  const activeSessionId = state.sessionKey ?? state.sessionId;

  // Enter always sends — `send()` itself routes to session.steer when the
  // agent is mid-turn. The Stop button (below) is the explicit interrupt path.
  const submitText = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Clear the input only when the text was actually submitted. When there's
    // no live session `send()` no-ops (returns false) and the draft must be
    // preserved so it isn't silently lost.
    if (send(trimmed)) setText('');
  };

  const onButtonClick = () => {
    if (state.streaming) {
      stop();
      return;
    }
    submitText();
  };

  const onArchive = async () => {
    const md = await archive();
    downloadArchive(state.title, md);
  };

  const onRename = async () => {
    if (!renamingId) return;
    const draft = renameDraft.trim();
    if (draft) await rename(draft);
    setRenamingId(null);
  };

  const handleAttach = async (file: File) => {
    if (!file) return;
    try {
      // The browser gives a File with no server-side path. Stage it at a
      // no-space temp path the gateway can attach (the gateway's attach path
      // can't contain whitespace, so the "Privy Cloud" library dir won't work),
      // then attach by that path.
      const { path } = await api.stageFile(file);
      if (file.type.startsWith('image/')) await attachImage(path);
      else await attachFile(path, file.name);
    } catch {
      // Upload or attach failed — the chip is not added.
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {state.pendingApproval && (
        <HermesApprovalDialog prompt={state.pendingApproval} onRespond={respondApproval} />
      )}
      {state.pendingClarify && (
        <HermesClarifyDialog prompt={state.pendingClarify} onRespond={respondClarify} />
      )}
      {!isMobile && (
      <aside
        style={{
          width: 220,
          flexShrink: 0,
          borderRight: '1px solid var(--border)',
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          overflowY: 'auto',
        }}
      >
        <button className="btn primary" onClick={newSession}>＋ New session</button>
        <button className="btn" onClick={() => { void mostRecent(); }}>↻ Reopen last</button>
        {sessions.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: 12, padding: '4px 2px' }}>No sessions yet.</div>
        )}
        {sessions.map((s) => {
          const active = s.id === activeSessionId;
          return (
            <button
              key={s.id}
              className="btn"
              onClick={() => resume(s.id)}
              aria-pressed={active}
              style={{
                textAlign: 'left',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                ...(active ? { background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600 } : {}),
              }}
            >
              {s.title}
            </button>
          );
        })}
      </aside>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="panel-title">Hermes Agent</div>
          {state.sessionId && (
            <div style={{ position: 'relative' }}>
              <button
                className="btn"
                aria-label="session actions"
                onClick={() => setMenuOpenId(menuOpenId ? null : '__active__')}
              >
                ⋯
              </button>
              {menuOpenId === '__active__' && !renamingId && !deletingId && (
                <div
                  className="session-action-menu"
                  style={{ position: 'absolute', right: 0, top: '100%', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', flexDirection: 'column', minWidth: 140, zIndex: 10 }}
                >
                  <button className="btn" onClick={() => { setMenuOpenId(null); void onArchive(); }}>Archive</button>
                  <button className="btn" onClick={() => { setRenamingId('__active__'); setRenameDraft(state.title); setMenuOpenId(null); }}>Rename</button>
                  <button className="btn" onClick={() => { setDeletingId('__active__'); setMenuOpenId(null); }}>Delete</button>
                </div>
              )}
              {renamingId === '__active__' && (
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <input
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void onRename(); }}
                    style={{ flex: 1, padding: 6, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--inputbg)', color: 'var(--text)' }}
                  />
                  <button className="btn" onClick={() => void onRename()}>Save</button>
                  <button className="btn" onClick={() => setRenamingId(null)}>Cancel</button>
                </div>
              )}
              {deletingId === '__active__' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4, alignItems: 'flex-end' }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Delete this session?</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn" onClick={() => { setDeletingId(null); void remove(); }}>Confirm</button>
                    <button className="btn" onClick={() => setDeletingId(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {state.messages.length === 0 && (
            <div className="empty-state">Ask your local Hermes agent anything.</div>
          )}
          {state.messages.map((m) => <MemoMessageView key={m.id} msg={m} />)}
        </div>
        {state.status && <div style={{ color: 'var(--muted)', fontSize: 11, padding: '4px 2px' }}>{state.status}</div>}
        {showPicker && (
          <div style={{ position: 'relative', marginBottom: 6 }}>
            <HermesModelPicker
              sessionId={state.sessionId}
              currentModel={state.currentModel}
              currentProvider={state.currentProvider}
              currentEffort={state.currentEffort}
              setModel={setModel}
              setEffort={setEffort}
              onClose={() => setShowPicker(false)}
            />
          </div>
        )}
        {text.trim().startsWith('/') && slashItems.length > 0 && (
          <div style={{ position: 'relative', marginBottom: 6 }}>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              {slashItems.map((it) => (
                <button
                  key={it.text}
                  className="btn"
                  style={{ display: 'block', width: '100%', textAlign: 'left' }}
                  onClick={() => { setText(it.text); setSlashItems([]); }}
                >
                  {it.text}
                </button>
              ))}
            </div>
          </div>
        )}
        {state.pendingAttachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
            {state.pendingAttachments.map((a, i) => (
              <span
                key={i}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--inputbg)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 6px', fontSize: 11, color: 'var(--text)' }}
              >
                {a.label}
                <button className="btn" aria-label={`remove ${a.label}`} onClick={() => removeAttachment(i)} style={{ padding: 0, fontSize: 10, lineHeight: 1 }}>✕</button>
              </span>
            ))}
          </div>
        )}
        <div className="send-input">
          <button className="btn" aria-label="attach" onClick={() => fileRef.current?.click()} style={{ flexShrink: 0 }}>📎</button>
          <input
            ref={fileRef}
            type="file"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleAttach(f); }}
          />
          <button
            className="btn"
            aria-label="model"
            onClick={() => setShowPicker((v) => !v)}
            style={{ flexShrink: 0 }}
          >
            {state.currentModel ?? 'model'}{state.currentEffort ? ` · ${state.currentEffort}` : ''}
          </button>
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
    </div>
  );
}
