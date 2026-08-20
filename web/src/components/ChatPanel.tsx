import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { KINDS, type ChatEntry, type Kind } from '@privy/shared';

const ICON: Record<Kind, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.icon])) as Record<Kind, string>;

function Entry({ entry, onOpenFile }: { entry: ChatEntry; onOpenFile: (p: string) => void }) {
  const icon = entry.kind === 'text' ? '✏️' : ICON[entry.kind] ?? '📦';
  // A chat text entry is backed by a Markdown file (storeText writes it), so it is
  // clickable too — clicking opens that stored file in the sharing viewer.
  const body = entry.kind === 'text'
    ? (entry.path ? <span className="chat-text-open" title="Open the stored file" onClick={() => onOpenFile(entry.path!)}>{entry.text}</span> : <span>{entry.text}</span>)
    : <span className="chat-fname" onClick={() => onOpenFile(entry.path!)}>{entry.name}</span>;
  return (
    <div className="chat-entry">
      <div className="chat-icon">{icon}</div>
      <div className="chat-bubble">
        {body}
        {entry.kind !== 'text' && <span style={{ color: 'var(--muted)', fontSize: 12 }}> → {entry.path}</span>}
        <span className="chat-time">{new Date(entry.ts).toLocaleString()} · {entry.sender}</span>
      </div>
    </div>
  );
}

export function ChatPanel(props: { entries: ChatEntry[]; onSendText(t: string): void; onSendFiles(f: File[]): void; onSendFolder(f: File[]): void; onOpenFile(p: string): void }) {
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Like a chat app: stay pinned to the bottom so the newest message is always in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [props.entries]);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => { props.onSendFiles([...e.target.files!]); e.target.value = ''; };
  const onDir = (e: ChangeEvent<HTMLInputElement>) => { props.onSendFolder([...e.target.files!]); e.target.value = ''; };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-title">Chat</div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }}>
        {props.entries.length === 0 && <div className="empty-state">Send a message, file, or folder to get started.</div>}
        {props.entries.map((e) => <Entry key={e.id} entry={e} onOpenFile={props.onOpenFile} />)}
      </div>
      <div className="send-input">
        <input value={text} placeholder="Send message, file, folder…" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { props.onSendText(text.trim()); setText(''); } }} />
        <button className="btn" aria-label="attach file" onClick={() => fileRef.current?.click()}>📎</button>
        <button className="btn" aria-label="attach folder" onClick={() => dirRef.current?.click()}>📁</button>
        <button className="btn primary" disabled={!text.trim()} onClick={() => { props.onSendText(text.trim()); setText(''); }}>Send</button>
        <input ref={fileRef} type="file" multiple hidden onChange={onFile} />
        <input ref={dirRef} type="file" {...({ webkitdirectory: '' } as any)} multiple hidden onChange={onDir} />
      </div>
    </div>
  );
}
