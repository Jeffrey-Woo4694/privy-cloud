import { useCallback, useEffect, useMemo, useState } from 'react';
import { KINDS, type ChatEntry, type FileItem, type Kind } from '@privy/shared';
import { api } from '../api';
import { connect } from '../ws';
import { SharingSidebar } from '../components/SharingSidebar';
import { PathBar } from '../components/PathBar';
import { SharingGrid } from '../components/SharingGrid';
import { ChatPanel } from '../components/ChatPanel';
import { FileViewer } from '../components/FileViewer';
import { usePrivyHermes } from '../hermes/usePrivyHermes';
import { itemsForLocation, type Location } from '../sharingLocation';

/** The chat API returns newest-first; reverse to chronological so the latest message is at the bottom. */
function chronological<T>(entries: T[]): T[] {
  return [...entries].reverse();
}

export interface TrashItem { path: string; name: string; isDir: boolean; size: number; modifiedAt: string }

export function PrivyCloudTab() {
  const [items, setItems] = useState<FileItem[]>([]);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [loc, setLoc] = useState<Location>({ type: 'home' });
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [selected, setSelected] = useState<FileItem | null>(null);
  const [error, setError] = useState('');
  const [rootDir, setRootDir] = useState('');
  const [creating, setCreating] = useState<null | 'folder' | 'file'>(null);
  const [newName, setNewName] = useState('');

  // The @hermes bot works in the Privy Cloud base so it can read/write the files.
  useEffect(() => { api.getMeta().then((m) => setRootDir(m.root)).catch(() => {}); }, []);
  const privyBase = rootDir ? `${rootDir}/Privy Cloud` : '';
  const { botThread, sendTask, newSession, handleEvent } = usePrivyHermes(privyBase);

  const refreshTrash = useCallback(() => {
    void api.listTrash().then((r) => setTrashItems(r.items)).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [its, entries] = await Promise.all([api.listItems(), api.listChat()]);
      setItems(its);
      setChat(chronological(entries));
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { void refresh(); void refreshTrash(); }, [refresh, refreshTrash]);

  useEffect(() => {
    const disconnect = connect({
      onItemsChanged: () => {
        void api.listItems().then(setItems);
        void api.listChat().then((e) => setChat(chronological(e)));
        void refreshTrash();
      },
      onChatNew: (entry) => setChat((c) => [...c, entry]), // append → newest at the bottom
      onHermesEvent: handleEvent,
    });
    return disconnect;
  }, [handleEvent, refreshTrash]);

  const viewItems = useMemo(() => itemsForLocation(loc, items), [loc, items]);

  const sendText = async (text: string) => { await api.sendText(text); void refresh(); };
  const sendFiles = async (files: File[]) => { await api.sendFiles(files); void refresh(); };
  const sendFolder = async (files: File[]) => { await api.sendFolder(files); void refresh(); };
  const openFile = (path: string) => {
    const found = items.find((i) => i.path === path) ?? (() => {
      const ext = path.split('.').pop()?.toLowerCase() ?? '';
      const kind = (KINDS.find((k) => k.extensions.includes(ext))?.key ?? 'other') as Kind;
      return { name: path.split('/').pop() ?? path, path, kind, size: 0, isDir: false, modifiedAt: '' };
    })();
    setSelected(found);
  };
  const onSaved = async () => {
    await Promise.all([api.listItems().then(setItems), api.listChat().then((e) => setChat(chronological(e)))]);
  };

  // Navigate to a location (sidebar, breadcrumb, or folder tile); refresh trash when entering it.
  const navigate = (newLoc: Location) => {
    setLoc(newLoc);
    setCreating(null); setNewName(''); // never carry an open create dialog into a new location
    if (newLoc.type === 'trash') refreshTrash();
  };

  const handleTileSelect = (item: FileItem) => {
    if (item.isDir) navigate({ type: 'folder', path: item.path });
    else setSelected(item);
  };

  const goBack = () => {
    if (loc.type !== 'folder') return;
    const parts = loc.path.split('/');
    parts.pop();
    navigate(parts.length === 0 ? { type: 'home' } : { type: 'folder', path: parts.join('/') });
  };

  // Recycle bin actions.
  const trashFile = async (path: string) => {
    try {
      await api.trashPath(path);
      setSelected(null);
      void refresh();
      void refreshTrash();
    } catch (e) { setError((e as Error).message); }
  };
  const restoreItem = async (path: string) => {
    try { await api.restoreFromTrash(path); void refresh(); void refreshTrash(); }
    catch (e) { setError((e as Error).message); }
  };
  const deleteItem = async (path: string) => {
    try { await api.deleteFromTrash(path); void refreshTrash(); }
    catch (e) { setError((e as Error).message); }
  };

  const canCreate = loc.type === 'home' || loc.type === 'folder';
  const parentRel = loc.type === 'folder' ? loc.path : '';
  const confirmCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      if (creating === 'folder') await api.createFolder(parentRel, name);
      else await api.createFile(parentRel, name, '');
      setCreating(null); setNewName('');
      void refresh();
    } catch (e) { setError((e as Error).message); }
  };

  const rightPanel = (
    <div className="panel" style={{ width: '30%', flexShrink: 0, minWidth: 0, padding: 12 }}>
      <ChatPanel entries={chat} botThread={botThread} onSendText={sendText} onSendHermes={sendTask} onNewSession={newSession}
        onSendFiles={sendFiles} onSendFolder={sendFolder} onOpenFile={openFile} />
    </div>
  );

  if (selected) {
    return (
      <div style={{ display: 'flex', gap: 12, padding: 12, width: '100%' }}>
        <div className="panel" style={{ flex: 1, padding: 12, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <FileViewer item={selected} onBack={() => setSelected(null)} onSaved={onSaved} onTrash={trashFile} />
        </div>
        {rightPanel}
        {error && <div className="toast">{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 12, padding: 12, width: '100%' }}>
      <div className="panel" style={{ flex: 1, padding: 12, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <SharingSidebar location={loc} onSelect={navigate} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}><PathBar location={loc} onNavigate={navigate} onBack={goBack} canGoBack={loc.type === 'folder'} /></div>
              {canCreate && creating === null && (
                <>
                  <button className="btn" onClick={() => { setCreating('folder'); setNewName(''); }}>+ Folder</button>
                  <button className="btn" onClick={() => { setCreating('file'); setNewName(''); }}>+ File</button>
                </>
              )}
              {canCreate && creating !== null && (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void confirmCreate(); if (e.key === 'Escape') { setCreating(null); setNewName(''); } }}
                    placeholder={creating === 'folder' ? 'Folder name' : 'File name'}
                    style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #3a3a3a', background: '#1a1a1a', color: 'inherit', minWidth: 140 }} />
                  <button className="btn btn-primary" onClick={() => void confirmCreate()}>Create</button>
                  <button className="btn" onClick={() => { setCreating(null); setNewName(''); }}>Cancel</button>
                </span>
              )}
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loc.type === 'trash' ? (
                <div className="trash-list">
                  {trashItems.length === 0 && <div className="empty-state">Trash is empty.</div>}
                  {trashItems.map((t) => (
                    <div key={t.path} className="trash-row">
                      <span>{t.isDir ? '📁' : '📄'} {t.path}</span>
                      <span style={{ flex: 1 }} />
                      <button className="btn" onClick={() => restoreItem(t.path)}>Restore</button>
                      <button className="btn" onClick={() => deleteItem(t.path)}>Delete forever</button>
                    </div>
                  ))}
                </div>
              ) : (
                <SharingGrid items={viewItems} onSelect={handleTileSelect}
                  emptyMessage={loc.type === 'recent' ? 'Nothing here yet — send something from the chat.' : 'This folder is empty.'} />
              )}
            </div>
          </div>
        </div>
        <div className="status-bar">
          {loc.type === 'trash'
            ? `${trashItems.length} item${trashItems.length === 1 ? '' : 's'} in trash`
            : `${viewItems.length} item${viewItems.length === 1 ? '' : 's'}`}
        </div>
      </div>
      {rightPanel}
      {error && <div className="toast">{error}</div>}
    </div>
  );
}
