import { useCallback, useEffect, useMemo, useState } from 'react';
import { KIND_FOLDER, KINDS, type ChatEntry, type FileItem, type Kind } from '@privy/shared';
import { api } from '../api';
import { connect } from '../ws';
import { KindFilter, type KindFilterValue } from '../components/KindFilter';
import { SharingGrid } from '../components/SharingGrid';
import { ChatPanel } from '../components/ChatPanel';
import { FileViewer } from '../components/FileViewer';
import { directChildren, parentPath } from '../sharingView';
import { usePrivyHermes } from '../hermes/usePrivyHermes';

/** The chat API returns newest-first; reverse to chronological so the latest message is at the bottom. */
function chronological<T>(entries: T[]): T[] {
  return [...entries].reverse();
}

export function PrivyCloudTab() {
  const [items, setItems] = useState<FileItem[]>([]);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [kind, setKind] = useState<KindFilterValue>('all');
  const [currentPath, setCurrentPath] = useState(''); // '' = root of Privy Cloud/
  const [selected, setSelected] = useState<FileItem | null>(null);
  const [error, setError] = useState('');
  const [rootDir, setRootDir] = useState('');

  // The @hermes bot works in the Privy Cloud base so it can read/write the files.
  useEffect(() => { api.getMeta().then((m) => setRootDir(m.root)).catch(() => {}); }, []);
  const privyBase = rootDir ? `${rootDir}/Privy Cloud` : '';
  const { botThread, sendTask, newSession, handleEvent } = usePrivyHermes(privyBase);

  const refresh = useCallback(async () => {
    try {
      const [its, entries] = await Promise.all([api.listItems(), api.listChat()]);
      setItems(its);
      setChat(chronological(entries)); // newest at the bottom, like a chat app
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const disconnect = connect({
      // Files change (uploads, Hermes deletions): resync BOTH the grid and the
      // chat so entries whose file was removed disappear from the chat too.
      onItemsChanged: () => {
        void api.listItems().then(setItems);
        void api.listChat().then((e) => setChat(chronological(e)));
      },
      onChatNew: (entry) => setChat((c) => [...c, entry]), // append → newest at the bottom
      onHermesEvent: handleEvent,
    });
    return disconnect;
  }, [handleEvent]);

  const viewItems = useMemo(() => directChildren(items, currentPath, kind), [items, currentPath, kind]);

  const sendText = async (text: string) => { await api.sendText(text); void refresh(); };
  const sendFiles = async (files: File[]) => { await api.sendFiles(files); void refresh(); };
  const sendFolder = async (files: File[]) => { await api.sendFolder(files); void refresh(); };
  const openFile = (path: string) => {
    const found = items.find((i) => i.path === path) ?? (() => {
      // Fallback when the item isn't in the current listing (e.g. its file was
      // deleted after the chat entry was created): still open with the right kind
      // so a .md chat entry renders as markdown rather than an unknown blob.
      const ext = path.split('.').pop()?.toLowerCase() ?? '';
      const kind = (KINDS.find((k) => k.extensions.includes(ext))?.key ?? 'other') as Kind;
      return { name: path.split('/').pop() ?? path, path, kind, size: 0, isDir: false, modifiedAt: '' };
    })();
    setSelected(found);
  };
  const onSaved = async () => {
    await Promise.all([api.listItems().then(setItems), api.listChat().then((e) => setChat(chronological(e)))]);
  };

  // Navigate into/out of a directory. Kind resets to 'all' so the newly shown
  // directory's contents are never hidden by a stale file-type filter.
  const navigate = (path: string) => { setCurrentPath(path); setKind('all'); };

  // A folder tile opens the folder; a file opens the viewer.
  const handleTileSelect = (item: FileItem) => {
    if (item.isDir) navigate(item.path);
    else setSelected(item);
  };

  // At the root the kind chips jump straight into that category directory;
  // inside a directory they filter the visible files by type.
  const handleKind = (k: KindFilterValue) => {
    setKind(k);
    if (currentPath === '' && k !== 'all') setCurrentPath(KIND_FOLDER[k as Kind]);
  };

  return (
    <div style={{ display: 'flex', gap: 12, padding: 12, width: '100%' }}>
      <div className="panel" style={{ flex: 1, padding: 12, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {selected ? (
          <FileViewer item={selected} onBack={() => setSelected(null)} onSaved={onSaved} />
        ) : (
          <>
            <div className="panel-title">Sharing</div>
            <KindFilter value={kind} onChange={handleKind} />
            {currentPath !== '' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <button className="back-link" onClick={() => navigate(parentPath(currentPath))}>← Back</button>
                <span aria-label="current directory" style={{ color: 'var(--muted)', fontSize: 13, wordBreak: 'break-all' }}>{currentPath}</span>
              </div>
            )}
            <SharingGrid items={viewItems} onSelect={handleTileSelect} emptyMessage={currentPath ? 'This folder is empty.' : undefined} />
          </>
        )}
      </div>
      <div className="panel" style={{ width: '30%', flexShrink: 0, padding: 12 }}>
        <ChatPanel entries={chat} botThread={botThread} onSendText={sendText} onSendHermes={sendTask} onNewSession={newSession}
          onSendFiles={sendFiles} onSendFolder={sendFolder} onOpenFile={openFile} />
      </div>
      {error && <div className="toast">{error}</div>}
    </div>
  );
}
