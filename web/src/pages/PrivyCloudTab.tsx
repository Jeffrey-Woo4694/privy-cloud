import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KINDS, type ChatEntry, type FileItem, type Kind } from '@privy/shared';
import { api } from '../api';
import type { DropItem } from '../dropPayload';
import { useFileDrop } from '../useFileDrop';
import { connect } from '../ws';
import { useMediaQuery } from '../useMediaQuery';
import { SharingSidebar } from '../components/SharingSidebar';
import { PathBar } from '../components/PathBar';
import { SharingGrid } from '../components/SharingGrid';
import { ListView } from '../components/ListView';
import { CreateDialog, type CreateKind } from '../components/CreateDialog';
import { CreateMenu } from '../components/CreateMenu';
import { ViewOptions, type DisplaySize } from '../components/ViewOptions';
import { GridIcon, ListIcon, DotsIcon, ShapeIcon } from '../components/icons';
import { sortItems, nextSort, type Sort, type SortKey } from '../sortItems';
import { ChatPanel } from '../components/ChatPanel';
import { FileViewer } from '../components/FileViewer';
import { usePrivyHermes } from '../hermes/usePrivyHermes';
import { CATEGORY_PLACES, itemsForLocation, locationKey, type Location, type Place } from '../sharingLocation';

// The virtual places (sidebar's first group) + the category folders, shown as a
// horizontal, scrollable place row on the phone where the desktop sidebar is hidden.
const MOBILE_PLACES: Place[] = [
  { id: 'Home', label: 'Home', icon: 'home', location: { type: 'home' } as Location },
  { id: 'Recent', label: 'Recent', icon: 'recent', location: { type: 'recent' } as Location },
  { id: 'Trash', label: 'Trash', icon: 'trash', location: { type: 'trash' } as Location },
  ...CATEGORY_PLACES,
];
import { ContextMenu } from '../components/ContextMenu';
import { buildMenu, type MenuAction, type MenuContext } from '../contextMenu';

/** The chat API returns newest-first; reverse to chronological so the latest message is at the bottom. */
function chronological<T>(entries: T[]): T[] {
  return [...entries].reverse();
}

export interface TrashItem { path: string; name: string; isDir: boolean; size: number; modifiedAt: string }

export function PrivyCloudTab() {
  const [items, setItems] = useState<FileItem[]>([]);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [loc, setLoc] = useState<Location>({ type: 'home' });
  // Browser-style back/forward: a stack of visited locations plus the index we're
  // showing. Navigating to a new place pushes (dropping any forward tail); ‹ / ›
  // move the index so you can revisit where you've been. Initialised with Home.
  const [history, setHistory] = useState<Location[]>([{ type: 'home' }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [selected, setSelected] = useState<FileItem | null>(null);
  // On mobile the Sharing/Hermes chat fills the screen; the file browser is a
  // separate view toggled from the "Files" affordance.
  const isMobile = useMediaQuery('(max-width: 820px)');
  const [mobileFiles, setMobileFiles] = useState(false);
  const [error, setError] = useState('');
  const [rootDir, setRootDir] = useState('');
  const [createDialog, setCreateDialog] = useState<CreateKind | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; ctx: MenuContext } | null>(null);
  const [renaming, setRenaming] = useState<FileItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TrashItem | null>(null);
  // File-manager grid state: single-click selection + a copy/paste clipboard that
  // survives navigation (copy in one folder, paste into another).
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null); // last plain-clicked path, for Shift+click range select
  const [clipboard, setClipboard] = useState<{ mode: 'copy' | 'cut'; items: FileItem[] }>({ mode: 'copy', items: [] });
  // Grid/list view + sort (persisted, like a file manager). Default grid, sort by Name ↑.
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => (localStorage.getItem('privy-view') as 'grid' | 'list') || 'grid');
  const [sort, setSort] = useState<Sort>(() => {
    try { return JSON.parse(localStorage.getItem('privy-sort') || '') as Sort; } catch { return { key: 'name', dir: 'asc' }; }
  });
  useEffect(() => { localStorage.setItem('privy-view', viewMode); }, [viewMode]);
  useEffect(() => { localStorage.setItem('privy-sort', JSON.stringify(sort)); }, [sort]);
  // View options: icon size, show hidden files, and the popover open state.
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [displaySize, setDisplaySize] = useState<DisplaySize>(() => (localStorage.getItem('privy-display-size') as DisplaySize) || 'medium');
  const [showHidden, setShowHidden] = useState(() => localStorage.getItem('privy-show-hidden') === '1');
  useEffect(() => { localStorage.setItem('privy-display-size', displaySize); }, [displaySize]);
  useEffect(() => { localStorage.setItem('privy-show-hidden', showHidden ? '1' : '0'); }, [showHidden]);
  const showHiddenRef = useRef(showHidden);
  useEffect(() => { showHiddenRef.current = showHidden; }, [showHidden]);

  // The @hermes bot works in the Privy Cloud base so it can read/write the files.
  useEffect(() => { api.getMeta().then((m) => setRootDir(m.root)).catch(() => {}); }, []);
  const privyBase = rootDir ? `${rootDir}/Privy Cloud` : '';
  const { botThread, sendTask, newSession, handleEvent } = usePrivyHermes(privyBase);

  const refreshTrash = useCallback(() => {
    void api.listTrash().then((r) => setTrashItems(r.items)).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [its, entries] = await Promise.all([api.listItems(undefined, showHiddenRef.current), api.listChat()]);
      setItems(its);
      setChat(chronological(entries));
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { void refresh(); void refreshTrash(); }, [refresh, refreshTrash]);

  useEffect(() => {
    const disconnect = connect({
      onItemsChanged: () => {
        void api.listItems(undefined, showHiddenRef.current).then(setItems);
        void api.listChat().then((e) => setChat(chronological(e)));
        void refreshTrash();
      },
      onChatNew: (entry) => setChat((c) => [...c, entry]), // append → newest at the bottom
      onHermesEvent: handleEvent,
    });
    return disconnect;
  }, [handleEvent, refreshTrash]);

  const viewItems = useMemo(() => itemsForLocation(loc, items), [loc, items]);
  const sortedItems = useMemo(() => sortItems(viewItems, sort), [viewItems, sort]);
  const onSort = useCallback((key: SortKey) => setSort((s) => nextSort(s, key)), []);
  const onSortPreset = useCallback((s: Sort) => setSort(s), []);
  const ICON_SCALES: Record<DisplaySize, number> = { small: 0.78, medium: 1, large: 1.3 };
  const iconScale = ICON_SCALES[displaySize] ?? 1;
  const SIZE_ORDER: DisplaySize[] = ['small', 'medium', 'large'];
  const onDisplaySize = (delta: -1 | 1) => {
    const i = SIZE_ORDER.indexOf(displaySize);
    setDisplaySize(SIZE_ORDER[Math.min(Math.max(i + delta, 0), SIZE_ORDER.length - 1)]);
  };
  const onShowHidden = (v: boolean) => { showHiddenRef.current = v; setShowHidden(v); void refresh(); };

  // Drop a file/folder onto the sharing grid → it lands in the folder currently
  // being browsed ('home' → Privy Cloud root). Recent/Trash are virtual views — no
  // folder to write into, so drop is disabled there. Files are written via the
  // upload endpoint (no chat entry); the grid refreshes afterwards.
  const dropTarget = loc.type === 'folder' ? loc.path : loc.type === 'home' ? '' : null;
  const { dragging: gridDragging, onDragOver: gridDragOver, onDragLeave: gridDragLeave, onDrop: gridDrop } =
    useFileDrop(async (items: DropItem[]) => {
      if (dropTarget === null) return;
      try { await api.uploadFiles(dropTarget, items); void refresh(); }
      catch (e) { setError((e as Error).message); }
    }, dropTarget === null);

  const sendText = async (text: string) => { await api.sendText(text); void refresh(); };
  const sendFiles = async (files: File[]) => { await api.sendFiles(files); void refresh(); };
  const sendFolder = async (files: File[]) => { await api.sendFolder(files); void refresh(); };
  const openFile = (path: string) => {
    const found = items.find((i) => i.path === path) ?? (() => {
      const ext = path.split('.').pop()?.toLowerCase() ?? '';
      const kind = (KINDS.find((k) => k.extensions.includes(ext))?.key ?? 'other') as Kind;
      return { name: path.split('/').pop() ?? path, path, kind, size: 0, isDir: false, modifiedAt: '' };
    })();
    // A folder (e.g. a directory shared via the chat) should navigate the grid into it,
    // not open a viewer that just says "folders are shown in the grid".
    if (found.isDir) { navigate({ type: 'folder', path: found.path }); return; }
    setSelected(found);
  };
  const onSaved = async () => {
    await Promise.all([api.listItems(undefined, showHiddenRef.current).then(setItems), api.listChat().then((e) => setChat(chronological(e)))]);
  };

  // Enter a location: the shared bookkeeping that navigation and back/forward both
  // need (clear any open dialog + selection, refresh the trash list when entering it).
  const enterLocation = (newLoc: Location) => {
    setLoc(newLoc);
    setCreateDialog(null); // never carry an open create dialog into a new location
    setSelection(new Set()); // entering a new directory clears the grid selection (clipboard persists)
    setRangeAnchor(null);
    if (newLoc.type === 'trash') refreshTrash();
  };

  // Navigate to a location (sidebar, breadcrumb, or folder tile); push it onto the
  // history stack (a fresh branch discards any forward entries).
  const navigate = (newLoc: Location) => {
    if (locationKey(newLoc) === locationKey(loc)) return; // already here — no history entry
    enterLocation(newLoc);
    const next = [...history.slice(0, historyIndex + 1), newLoc];
    setHistory(next);
    setHistoryIndex(next.length - 1);
  };

  const goBack = () => {
    if (historyIndex <= 0) return;
    setHistoryIndex(historyIndex - 1);
    enterLocation(history[historyIndex - 1]);
  };

  const goForward = () => {
    if (historyIndex >= history.length - 1) return;
    setHistoryIndex(historyIndex + 1);
    enterLocation(history[historyIndex + 1]);
  };

  // Phone file browser: the subheader "← Back" walks up the folder history, and
  // only returns to the chat once you're back at the top (Home / root).
  const backFromFiles = () => {
    if (historyIndex > 0) goBack();
    else setMobileFiles(false);
  };

  // File-manager model: a single click SELECTS the tile; a double click opens it.
  // Shift+click selects the contiguous range from the last clicked tile (anchor).
  const handleTileSelect = (item: FileItem, shiftKey: boolean) => {
    if (shiftKey && rangeAnchor !== null) {
      const idxA = viewItems.findIndex((i) => i.path === rangeAnchor);
      const idxB = viewItems.findIndex((i) => i.path === item.path);
      if (idxA >= 0 && idxB >= 0) {
        const [s, e] = idxA <= idxB ? [idxA, idxB] : [idxB, idxA];
        setSelection(new Set(viewItems.slice(s, e + 1).map((i) => i.path)));
        return;
      }
    }
    setSelection(new Set([item.path]));
    setRangeAnchor(item.path);
  };

  const handleTileOpen = (item: FileItem) => {
    setSelection(new Set());
    setRangeAnchor(null);
    if (item.isDir) navigate({ type: 'folder', path: item.path });
    else setSelected(item);
  };

  const trashPaths = async (items: FileItem[]) => {
    if (!items.length) return;
    try {
      for (const it of items) await api.trashPath(it.path);
      setSelection(new Set());
      void refresh();
      void refreshTrash();
    } catch (e) { setError((e as Error).message); }
  };

  const pasteClipboard = async () => {
    if (!clipboard.items.length) return;
    if (loc.type !== 'folder' && loc.type !== 'home') return;
    const tgt = loc.type === 'folder' ? loc.path : '';
    try {
      await (clipboard.mode === 'cut' ? api.move : api.copy)(clipboard.items.map((i) => i.path), tgt);
      setSelection(new Set());
      if (clipboard.mode === 'cut') setClipboard({ mode: 'copy', items: [] }); // a cut paste is a one-time move
      void refresh();
    } catch (e) { setError((e as Error).message); }
  };

  // Drag a grid tile onto a folder tile → move it into that folder.
  const moveTo = async (fromPath: string, toFolderPath: string) => {
    try {
      await api.move([fromPath], toFolderPath);
      setSelection(new Set());
      setRangeAnchor(null);
      void refresh();
    } catch (e) { setError((e as Error).message); }
  };

  // Keyboard shortcuts for the grid (desktop file-manager style), only while browsing
  // (no file viewer open), not typing in an input, and no dialog/menu is up. Uses a ref
  // so the single window listener always reads the latest state.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const canOperate = loc.type === 'folder' || loc.type === 'home';
    keyRef.current = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (menu || createDialog || renaming || confirmDelete) return;
      if (selected) return; // a file viewer is open — grid shortcuts are off
      if (!canOperate) return; // recent/trash — no file-system operations
      const sels = viewItems.filter((i) => selection.has(i.path));
      if (!e.ctrlKey && !e.metaKey) {
        if (e.key === 'Escape') { e.preventDefault(); goBack(); }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'a') { e.preventDefault(); setSelection(new Set(viewItems.map((i) => i.path))); }
      else if (k === 'c') { e.preventDefault(); if (sels.length) setClipboard({ mode: 'copy', items: sels }); }
      else if (k === 'x') { e.preventDefault(); if (sels.length) setClipboard({ mode: 'cut', items: sels }); }
      else if (k === 'd') { e.preventDefault(); void trashPaths(sels); }
      else if (k === 'v') { e.preventDefault(); void pasteClipboard(); }
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  const canCreate = loc.type === 'home' || loc.type === 'folder';
  const parentRel = loc.type === 'folder' ? loc.path : '';
  const confirmCreate = async (kind: CreateKind, name: string) => {
    const v = name.trim();
    if (!v) return;
    try {
      if (kind === 'folder') await api.createFolder(parentRel, v);
      else await api.createFile(parentRel, v, '');
      // A dot-prefixed item is hidden; turn on "Show Hidden Files" so it appears.
      if (v.startsWith('.')) { showHiddenRef.current = true; setShowHidden(true); }
      setCreateDialog(null);
      void refresh();
    } catch (e) { setError((e as Error).message); }
  };

  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenu = useCallback((e: React.MouseEvent, ctx: MenuContext) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, ctx });
  }, []);

  const handleMenuAction = async (action: MenuAction, ctx: MenuContext) => {
    closeMenu();
    if (action === 'new-folder') { setCreateDialog('folder'); return; }
    if (action === 'new-file') { setCreateDialog('file'); return; }
    if (ctx.kind === 'trash') {
      const t = ctx.item;
      if (action === 'restore') { await restoreItem(t.path); return; }
      if (action === 'delete-forever') { setConfirmDelete(t); return; }
      return;
    }
    if (ctx.kind !== 'item') return; // background menu: new-folder/new-file handled above
    const item = ctx.item;
    if (action === 'open') { handleTileOpen(item); return; }
    if (action === 'download' && !item.isDir) {
      const a = document.createElement('a');
      a.href = api.fileUrl(item.path);
      a.download = item.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    if (action === 'rename') { setRenaming(item); return; }
    if (action === 'trash') { await trashFile(item.path); return; }
    // 'share' is disabled and never dispatched.
  };

  const commitRename = async (item: FileItem, newName: string) => {
    const value = newName.trim();
    if (!value || value === item.name) { setRenaming(null); return; }
    try {
      const res = await api.rename(item.path, value);
      setRenaming(null);
      if (loc.type === 'folder' && loc.path === item.path) {
        navigate({ type: 'folder', path: res.path });
      } else if (loc.type === 'folder' && loc.path.startsWith(item.path + '/')) {
        navigate({ type: 'folder', path: res.path + loc.path.slice(item.path.length) });
      }
      void refresh();
    } catch (e) { setError((e as Error).message); setRenaming(null); }
  };
  const cancelRename = useCallback(() => setRenaming(null), []);

  const confirmDeleteForever = async () => {
    if (!confirmDelete) return;
    try { await api.deleteFromTrash(confirmDelete.path); void refreshTrash(); }
    catch (e) { setError((e as Error).message); }
    setConfirmDelete(null);
  };

  const rightPanel = (
    <div className="panel" style={{ width: '30%', flexShrink: 0, minWidth: 0, padding: 12 }}>
      <ChatPanel entries={chat} botThread={botThread} onSendText={sendText} onSendHermes={sendTask} onNewSession={newSession}
        onSendFiles={sendFiles} onSendFolder={sendFolder} onOpenFile={openFile} />
    </div>
  );

  // The file browser (sidebar + path bar + grid) shared by the desktop left panel
  // and the mobile "Shared files" view. On the phone the desktop sidebar and the
  // path bar are dropped so the grid gets the full width; "← Back" (backFromFiles)
  // walks up the folder history instead.
  const filesLayout = (
    <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
      {!isMobile && <SharingSidebar location={loc} onSelect={navigate} />}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {isMobile && (
          <div className="mobile-places" role="navigation" aria-label="places">
            {MOBILE_PLACES.map((p) => (
              <button key={p.id} className={`place-chip${locationKey(p.location) === locationKey(loc) ? ' active' : ''}`}
                onClick={() => navigate(p.location)}>
                <span className="place-chip-icon"><ShapeIcon name={p.icon} size={15} /></span>{p.label}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
          {!isMobile && <div style={{ flex: 1, minWidth: 0 }}><PathBar location={loc} onNavigate={navigate} onBack={goBack} onForward={goForward}
            canGoBack={historyIndex > 0} canGoForward={historyIndex < history.length - 1} /></div>}
          <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
            <div className="trail" role="group" aria-label="view options">
              <button className="trail-btn" onClick={() => setViewMode((m) => (m === 'grid' ? 'list' : 'grid'))}
                title={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
                aria-label={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                {viewMode === 'grid' ? <GridIcon /> : <ListIcon />}
              </button>
              <span className="trail-div" aria-hidden="true" />
              <button className="trail-btn" onClick={() => setViewOptionsOpen((o) => !o)} aria-label="View options" aria-expanded={viewOptionsOpen} title="View options"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><DotsIcon /></button>
              <ViewOptions open={viewOptionsOpen} onClose={() => setViewOptionsOpen(false)} sort={sort} onSort={onSortPreset}
                displaySize={displaySize} onDisplaySize={onDisplaySize} showHidden={showHidden} onShowHidden={onShowHidden} />
            </div>
            {canCreate && (
              <div style={{ position: 'relative' }}>
                <button className="btn" onClick={() => setCreateOpen((o) => !o)} aria-label="Create" aria-expanded={createOpen} title="Create"
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, padding: '6px 12px' }}>
                  <ShapeIcon name="chevronDown" size={16} />
                </button>
                <CreateMenu open={createOpen} onClose={() => setCreateOpen(false)} onPick={(kind) => { setCreateOpen(false); setCreateDialog(kind); }} />
              </div>
            )}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', position: 'relative', '--icon-scale': iconScale } as React.CSSProperties} onContextMenu={(e) => openMenu(e, { kind: 'background', canCreate })}
          onDragOver={gridDragOver} onDragLeave={gridDragLeave} onDrop={gridDrop}>
          {gridDragging && <div className="drop-overlay">Drop to upload into this folder</div>}
          {loc.type === 'trash' ? (
            <div className="trash-list">
              {trashItems.length === 0 && <div className="empty-state">Trash is empty.</div>}
              {trashItems.map((t) => (
                <div key={t.path} className="trash-row" onContextMenu={(e) => openMenu(e, { kind: 'trash', item: t })}>
                  <span className="trash-icon"><ShapeIcon name={t.isDir ? 'folder' : 'document'} size={15} /></span>
                  <span>{t.path}</span>
                  <span style={{ flex: 1 }} />
                  <button className="btn" onClick={() => restoreItem(t.path)}>Restore</button>
                  <button className="btn" onClick={() => setConfirmDelete(t)}>Delete forever</button>
                </div>
              ))}
            </div>
          ) : (
            viewMode === 'list' ? (
              <ListView items={sortedItems} onSelect={handleTileSelect} onOpen={handleTileOpen}
                selected={selection} singleClickOpens={isMobile} onMoveTo={moveTo}
                emptyMessage={loc.type === 'recent' ? 'Nothing here yet — send something from the chat.' : 'This folder is empty.'}
                onTileContextMenu={(e, item) => openMenu(e, { kind: 'item', item })}
                sort={sort} onSort={onSort} />
            ) : (
              <SharingGrid items={sortedItems} onSelect={handleTileSelect} onOpen={handleTileOpen}
                selected={selection} singleClickOpens={isMobile} onMoveTo={moveTo}
                emptyMessage={loc.type === 'recent' ? 'Nothing here yet — send something from the chat.' : 'This folder is empty.'}
                onTileContextMenu={(e, item) => openMenu(e, { kind: 'item', item })}
                renaming={renaming?.path ?? null}
                onCommitRename={(item, name) => void commitRename(item, name)}
                onCancelRename={cancelRename} />
            )
          )}
        </div>
      </div>
    </div>
  );

  if (selected) {
    return (
      <div style={{ display: 'flex', gap: 12, padding: 12, width: '100%', height: '100%', minWidth: 0 }}>
        <div className="panel" style={{ flex: 1, padding: 12, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <FileViewer item={selected} onBack={() => setSelected(null)} onSaved={onSaved} onTrash={trashFile} />
        </div>
        {!isMobile && rightPanel}
        {error && <div className="toast">{error}</div>}
        {createDialog && <CreateDialog kind={createDialog} onConfirm={(n) => void confirmCreate(createDialog, n)} onCancel={() => setCreateDialog(null)} />}
      </div>
    );
  }

  if (isMobile) {
    return (
      // .app-body is a row flex, so the mobile root must ask for the full width
      // (the desktop root does `width:100%` too); otherwise the file grid resolves
      // to a single column squeezed to the left of the viewport.
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
        {mobileFiles ? (
          <>
            <div className="mobile-subheader">
              <button className="btn" onClick={backFromFiles} aria-label="back to chat">← Back</button>
              <span style={{ flex: 1 }} />
              <span className="mobile-subtitle">Shared files</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {filesLayout}
            </div>
          </>
        ) : (
          <>
            <div className="mobile-subheader">
              <button className="btn" onClick={() => setMobileFiles(true)} aria-label="browse files">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ShapeIcon name="folder" size={15} /> Files</span>
              </button>
              <span style={{ flex: 1 }} />
              <span className="mobile-subtitle">Sharing & Hermes</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: 8 }}>
              <ChatPanel entries={chat} botThread={botThread} onSendText={sendText} onSendHermes={sendTask} onNewSession={newSession}
                onSendFiles={sendFiles} onSendFolder={sendFolder} onOpenFile={openFile} />
            </div>
          </>
        )}
        {error && <div className="toast">{error}</div>}
        {menu && buildMenu(menu.ctx).length > 0 && (
          <ContextMenu x={menu.x} y={menu.y} items={buildMenu(menu.ctx)}
            onSelect={(a) => void handleMenuAction(a, menu.ctx)} onClose={closeMenu} />
        )}
        {confirmDelete && (
          <div className="confirm-overlay" onClick={() => setConfirmDelete(null)}>
            <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="confirm-title">Delete forever?</div>
              <div className="confirm-text">Permanently delete “{confirmDelete.path}”? This can’t be undone.</div>
              <div className="confirm-actions">
                <button className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
                <button className="btn danger" onClick={() => void confirmDeleteForever()}>Delete</button>
              </div>
            </div>
          </div>
        )}
        {createDialog && <CreateDialog kind={createDialog} onConfirm={(n) => void confirmCreate(createDialog, n)} onCancel={() => setCreateDialog(null)} />}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 12, padding: 12, width: '100%', height: '100%', minWidth: 0 }}>
      <div className="panel" style={{ flex: 1, padding: 12, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {filesLayout}
      </div>
      {rightPanel}
      {error && <div className="toast">{error}</div>}
      {menu && buildMenu(menu.ctx).length > 0 && (
        <ContextMenu x={menu.x} y={menu.y} items={buildMenu(menu.ctx)}
          onSelect={(a) => void handleMenuAction(a, menu.ctx)} onClose={closeMenu} />
      )}
      {confirmDelete && (
        <div className="confirm-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Delete forever?</div>
            <div className="confirm-text">Permanently delete “{confirmDelete.path}”? This can’t be undone.</div>
            <div className="confirm-actions">
              <button className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn danger" onClick={() => void confirmDeleteForever()}>Delete</button>
            </div>
          </div>
        </div>
      )}
      {createDialog && <CreateDialog kind={createDialog} onConfirm={(n) => void confirmCreate(createDialog, n)} onCancel={() => setCreateDialog(null)} />}
    </div>
  );
}
