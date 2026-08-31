import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { ChatEntry } from '@privy/shared';
import type { PrivyBotMessage } from '../hermes/usePrivyHermes';
import { Markdown } from './Markdown';
import { api } from '../api';
import { useFileDrop } from '../useFileDrop';
import type { DropItem } from '../dropPayload';
import { partitionDrop } from '../dropPayload';
import { ShapeIcon, KIND_ICON } from './icons';

interface HermesRole { id: string; label: string }
const DEFAULT_ROLES: HermesRole[] = [{ id: 'hermes', label: 'Hermes' }];

function Entry({ entry, onOpenFile }: { entry: ChatEntry; onOpenFile: (p: string) => void }) {
  const icon = entry.kind === 'text' ? 'text' : KIND_ICON[entry.kind] ?? 'other';
  // A chat text entry is backed by a Markdown file (storeText writes it), so it is
  // clickable too — clicking opens that stored file in the sharing viewer.
  const body = entry.kind === 'text'
    ? (entry.path ? <span className="chat-text-open" title="Open the stored file" onClick={() => onOpenFile(entry.path!)}>{entry.text}</span> : <span>{entry.text}</span>)
    : <span className="chat-fname" onClick={() => onOpenFile(entry.path!)}>{entry.name}</span>;
  return (
    <div className="chat-entry">
      <div className="chat-icon"><ShapeIcon name={icon} size={16} /></div>
      <div className="chat-bubble">
        {body}
        {entry.kind !== 'text' && <span style={{ color: 'var(--muted)', fontSize: 12 }}> → {entry.path}</span>}
        <span className="chat-time">{new Date(entry.ts).toLocaleString()} · {entry.sender}</span>
      </div>
    </div>
  );
}

function BotEntry({ m }: { m: PrivyBotMessage }) {
  return (
    <div className="chat-entry">
      <div className="chat-icon"><ShapeIcon name={m.role === 'assistant' ? 'bot' : 'user'} size={16} /></div>
      <div className={`chat-bubble${m.role === 'assistant' ? ' chat-bot' : ''}`}>
        {m.role === 'assistant' && <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 12, display: 'block' }}>Hermes</span>}
        {m.text && (m.role === 'assistant'
          ? <Markdown>{m.text}</Markdown>
          : <span>{m.text}</span>)}
        {!m.text && m.streaming && '…'}
        {m.streaming && <span className="chat-time">thinking…</span>}
      </div>
    </div>
  );
}

type ChatTab = 'sharing' | 'hermes';

export function ChatPanel(props: {
  entries: ChatEntry[];
  botThread: PrivyBotMessage[];
  onSendText(t: string): void;
  onSendHermes(text: string): void;
  onNewSession(): void;
  onSendFiles(f: File[]): void;
  onSendFolder(f: File[]): void;
  onOpenFile(p: string): void;
}) {
  const [text, setText] = useState('');
  const [roles, setRoles] = useState<HermesRole[]>(DEFAULT_ROLES);
  const [mentionIndex, setMentionIndex] = useState(0);
  // Two streams, two tabs: file-sharing history vs. the Hermes conversation.
  const [activeTab, setActiveTab] = useState<ChatTab>('sharing');
  const [botUnread, setBotUnread] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const sharingRef = useRef<HTMLDivElement>(null);
  const hermesRef = useRef<HTMLDivElement>(null);

  // Drop a file/folder onto the chat → it uploads to its kind category (file → the
  // Pictures/Videos/… folder by type; directory → Folders/<name>), the same as the
  // 📎 / 📁 buttons. Loose files and directories may arrive in one drop, so partition
  // them: each directory group keeps its structure via webkitRelativePath.
  const { dragging, onDragOver, onDragLeave, onDrop } = useFileDrop((items: DropItem[]) => {
    const { files, folders } = partitionDrop(items);
    if (files.length) props.onSendFiles(files);
    for (const folderFiles of folders) props.onSendFolder(folderFiles);
  });

  // The @-mentionable roles (default agent + installed profiles). Best-effort:
  // on failure the default role keeps working.
  useEffect(() => {
    api.listHermesRoles()
      .then((r) => { if (r.roles?.length) setRoles(r.roles); })
      .catch(() => {});
  }, []);

  // Like a chat app: stay pinned to the bottom so the newest message is always in view.
  useEffect(() => {
    const el = activeTab === 'sharing' ? sharingRef.current : hermesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [props.entries, props.botThread, activeTab]);

  // Any bot-thread activity while looking at the Sharing tab → unread dot on Hermes.
  // (Streaming deltas rewrite the same message, so track reference changes, not
  // length — otherwise a reply that streams while you're on Sharing shows no dot.
  // Require a non-empty thread so an empty fresh mount doesn't show a dot.)
  useEffect(() => {
    if (props.botThread.length > 0 && activeTab !== 'hermes') setBotUnread(true);
  }, [props.botThread]);

  // Mention menu: only relevant on the Sharing tab — inside the Hermes view every
  // message goes to the agent, so '@' needs no menu there.
  const mentionMatch = /(^|\s)@([a-z0-9_-]*)$/i.exec(text);
  const mentionOpen = activeTab === 'sharing' && !!mentionMatch;
  const mentionPartial = mentionMatch ? mentionMatch[2] : '';
  const filteredRoles = roles.filter((r) => r.id.toLowerCase().startsWith(mentionPartial.toLowerCase()));
  useEffect(() => { setMentionIndex(0); }, [mentionOpen]);

  const selectRole = (role: HermesRole) => {
    // Insert the label (what the menu showed), not the id — so "Hermes" stays "Hermes".
    // Routing matches case-insensitively against the id, so @Hermes routes correctly.
    setText(text.replace(/@[a-z0-9_-]*$/i, `@${role.label} `)); // @role + trailing space
    setMentionIndex(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (mentionOpen && filteredRoles.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((i) => (i + 1) % filteredRoles.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex((i) => (i - 1 + filteredRoles.length) % filteredRoles.length); return; }
      if (e.key === 'Enter') { e.preventDefault(); selectRole(filteredRoles[mentionIndex] ?? filteredRoles[0]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setText(text.replace(/(^|\s)@[a-z0-9_-]*$/i, '$1')); return; }
    }
    if (e.key === 'Enter') submit(text);
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => { props.onSendFiles([...e.target.files!]); e.target.value = ''; };
  const onDir = (e: ChangeEvent<HTMLInputElement>) => { props.onSendFolder([...e.target.files!]); e.target.value = ''; };

  const switchTab = (t: ChatTab) => { setActiveTab(t); if (t === 'hermes') setBotUnread(false); };

  const submit = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setText('');
    // Inside the Hermes view, every message is for the agent (no @ needed).
    // From the Sharing view, "@<role>" delegates and anything else is a file.
    if (activeTab === 'hermes') {
      props.onSendHermes(trimmed);
      return;
    }
    const mention = /^@([a-z0-9_-]+)/i.exec(trimmed);
    const isRole = !!mention && roles.some((r) => r.id.toLowerCase() === mention[1].toLowerCase());
    if (isRole) { switchTab('hermes'); props.onSendHermes(trimmed); }
    else props.onSendText(trimmed);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {dragging && <div className="drop-overlay">Drop to upload to your library</div>}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
        <button className={`chat-tab${activeTab === 'sharing' ? ' active' : ''}`} onClick={() => switchTab('sharing')}>Sharing</button>
        <button className={`chat-tab${activeTab === 'hermes' ? ' active' : ''}`} onClick={() => switchTab('hermes')}>
          Hermes{botUnread ? ' ●' : ''}
        </button>
        <span style={{ flex: 1 }} />
        {/* Always rendered (hidden on Sharing) so the header row keeps a constant
            height and the Sharing/Hermes tabs don't shift when the button appears. */}
        <button className="btn" title="Start a new Hermes session" onClick={props.onNewSession}
          style={activeTab === 'sharing' ? { visibility: 'hidden' } : undefined}>＋ New session</button>
      </div>
      <div ref={sharingRef} style={{ flex: 1, overflowY: 'auto', display: activeTab === 'sharing' ? 'block' : 'none' }}>
        {props.entries.length === 0 && <div className="empty-state">Send a message, file, or folder to get started.</div>}
        {props.entries.map((e) => <Entry key={e.id} entry={e} onOpenFile={props.onOpenFile} />)}
      </div>
      <div ref={hermesRef} style={{ flex: 1, overflowY: 'auto', display: activeTab === 'hermes' ? 'block' : 'none' }}>
        {props.botThread.length === 0 && <div className="empty-state">Message the agent below — no @ needed here.</div>}
        {props.botThread.map((m) => <BotEntry key={m.id} m={m} />)}
      </div>
      <div style={{ position: 'relative' }}>
        {mentionOpen && filteredRoles.length > 0 && (
          <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 6, background: 'var(--panel2)', border: 'none', borderRadius: 12, maxHeight: 180, overflowY: 'auto', zIndex: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', padding: 6 }}>
            {filteredRoles.map((r, i) => (
              <div key={r.id}
                onMouseDown={(e) => { e.preventDefault(); selectRole(r); }}
                onMouseEnter={() => setMentionIndex(i)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer', background: i === mentionIndex ? 'var(--chipbg)' : 'transparent' }}>
                <ShapeIcon name="bot" size={16} />
                <span style={{ fontWeight: i === mentionIndex ? 600 : 400 }}>{r.label}</span>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>@{r.id}</span>
              </div>
            ))}
          </div>
        )}
        <div className="send-input">
          <input value={text} placeholder={activeTab === 'sharing' ? 'Send message, file, folder, or @hermes…' : 'Message Hermes…'}
            onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} />
          <button className="btn" aria-label="attach file" onClick={() => fileRef.current?.click()} title="Attach file"><ShapeIcon name="paperclip" size={16} /></button>
          <button className="btn" aria-label="attach folder" onClick={() => dirRef.current?.click()} title="Attach folder"><ShapeIcon name="folder" size={16} /></button>
          <button className="btn primary" disabled={!text.trim()} onClick={() => submit(text)}>Send</button>
          <input ref={fileRef} type="file" multiple hidden onChange={onFile} />
          <input ref={dirRef} type="file" {...({ webkitdirectory: '' } as any)} multiple hidden onChange={onDir} />
        </div>
      </div>
    </div>
  );
}
