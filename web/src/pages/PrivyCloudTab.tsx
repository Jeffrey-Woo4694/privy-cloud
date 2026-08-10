import { useCallback, useEffect, useState } from 'react';
import type { ChatEntry, FileItem, Kind } from '@privy/shared';
import { api } from '../api';
import { connect } from '../ws';
import { KindFilter, type KindFilterValue } from '../components/KindFilter';
import { SharingGrid } from '../components/SharingGrid';
import { ChatPanel } from '../components/ChatPanel';
import { FileViewer } from '../components/FileViewer';

export function PrivyCloudTab() {
  const [items, setItems] = useState<FileItem[]>([]);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [kind, setKind] = useState<KindFilterValue>('all');
  const [selected, setSelected] = useState<FileItem | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [its, entries] = await Promise.all([api.listItems(kind === 'all' ? undefined : kind as Kind), api.listChat()]);
      setItems(its); setChat(entries);
    } catch (e) { setError((e as Error).message); }
  }, [kind]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const disconnect = connect({
      onItemsChanged: () => { void api.listItems(kind === 'all' ? undefined : kind as Kind).then(setItems); },
      onChatNew: (entry) => setChat((c) => [entry, ...c]),
    });
    return disconnect;
  }, [kind]);

  const sendText = async (text: string) => { await api.sendText(text); void refresh(); };
  const sendFiles = async (files: File[]) => { await api.sendFiles(files); void refresh(); };
  const sendFolder = async (files: File[]) => { await api.sendFolder(files); void refresh(); };
  const openFile = (path: string) => {
    const found = items.find((i) => i.path === path) ?? { name: path.split('/').pop() ?? path, path, kind: 'other' as Kind, size: 0, isDir: false, modifiedAt: '' };
    setSelected(found);
  };
  const onSaved = async () => { await Promise.all([api.listItems(kind === 'all' ? undefined : kind as Kind).then(setItems), api.listChat().then(setChat)]); };

  if (selected) {
    return <FileViewer item={selected} onBack={() => setSelected(null)} onSaved={onSaved} />;
  }

  return (
    <div style={{ display: 'flex', gap: 12, padding: 12, width: '100%' }}>
      <div className="panel" style={{ flex: 1, padding: 12, minWidth: 0 }}>
        <div className="panel-title">Sharing</div>
        <KindFilter value={kind} onChange={(k) => setKind(k)} />
        <SharingGrid items={items} onSelect={(item) => setSelected(item)} />
      </div>
      <div className="panel" style={{ width: '30%', flexShrink: 0, padding: 12 }}>
        <ChatPanel entries={chat} onSendText={sendText} onSendFiles={sendFiles} onSendFolder={sendFolder} onOpenFile={openFile} />
      </div>
      {error && <div className="toast">{error}</div>}
    </div>
  );
}
