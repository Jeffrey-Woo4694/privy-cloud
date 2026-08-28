import type { ChatEntry, FileItem, Kind } from '@privy/shared';
import type { DropItem } from './dropPayload';
import { getToken } from './auth';

// Same-origin by default so the UI works when served by the backend (localhost, LAN, or tunnel).
// Dev mode overrides via web/.env.development (VITE_API_BASE=http://localhost:5178).
// The Tauri desktop shell loads the UI from its custom `tauri://localhost` protocol,
// which the backend does NOT serve — so when running under Tauri, target the local
// backend directly (its CORS allowlist already includes the tauri origin). In a
// browser (served by the backend, same-origin) `''` keeps it origin-relative.
export const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? (typeof window !== 'undefined' && window.location.protocol === 'tauri:' ? 'http://localhost:5178' : '');

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...init?.headers, authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listItems: (kind?: Kind): Promise<FileItem[]> => req(`/api/items${kind ? `?kind=${kind}` : ''}`),
  getFileText: (path: string): Promise<string> => fetch(`${API_BASE}/api/file?path=${encodeURIComponent(path)}`, { headers: { authorization: `Bearer ${getToken() ?? ''}` } }).then((r) => r.text()),
  saveFileText: (path: string, content: string) =>
    req(`/api/file?path=${encodeURIComponent(path)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) }),
  sendText: async (text: string): Promise<ChatEntry> =>
    (await req<{ entry: ChatEntry }>('/api/send/text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })).entry,
  sendFiles: async (files: File[]): Promise<ChatEntry[]> => {
    const entries: ChatEntry[] = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const r = await req<{ entry: ChatEntry }>('/api/send/file', { method: 'POST', body: fd });
      entries.push(r.entry);
    }
    return entries;
  },
  sendFolder: async (files: File[]): Promise<ChatEntry> => {
    const folderName = files[0]?.webkitRelativePath?.split('/')[0] ?? 'folder';
    const fd = new FormData();
    fd.append('folderName', folderName);
    for (const file of files) {
      // webkitRelativePath is "folder/sub/file.ext"; the backend joins relativePath under Folders/<folderName>,
      // so strip the leading segment (the folder name) so the structure is preserved without doubling it.
      const rel = (file.webkitRelativePath || file.name).split('/').slice(1).join('/') || file.name;
      fd.append('relativePath', rel);
      fd.append('file', file, file.name);
    }
    const r = await req<{ entry: ChatEntry }>('/api/send/folder', { method: 'POST', body: fd });
    return r.entry;
  },
  listChat: (limit = 50): Promise<ChatEntry[]> => req(`/api/chat?limit=${limit}`),
  // Drop files/folders into a specific vault folder (the sharing grid's current
  // folder). 'path' is the target folder rel ('' = Privy Cloud root); each item is
  // sent as `base` + `rel` fields immediately before its `file` part.
  uploadFiles: (path: string, items: DropItem[]): Promise<{ created: string[] }> => {
    const fd = new FormData();
    for (const it of items) {
      fd.append('base', it.base);
      fd.append('rel', it.rel);
      fd.append('file', it.file, it.file.name);
    }
    return req(`/api/upload?path=${encodeURIComponent(path)}`, { method: 'POST', body: fd });
  },
  getMeta: (): Promise<{ root: string; owner: string }> => req('/api/meta'),
  setRoot: async (path: string): Promise<string> =>
    (await req<{ root: string }>('/api/settings/root', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) })).root,
  proxyUrl: (path: string): string => `${API_BASE}/api/proxy?path=${encodeURIComponent(path)}&token=${encodeURIComponent(getToken() ?? '')}`,
  fileUrl: (path: string): string => `${API_BASE}/api/file?path=${encodeURIComponent(path)}&token=${encodeURIComponent(getToken() ?? '')}`,
  hermesCall: async (method: string, params?: unknown): Promise<unknown> =>
    (await req<{ result: unknown }>('/api/hermes/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })).result,
  // Stage an uploaded file at a no-space path the Hermes gateway can attach
  // (see `POST /api/hermes/stage` — the gateway's attach path can't contain
  // spaces, so files are staged under /tmp rather than the "Privy Cloud" dir).
  stageFile: (file: File): Promise<{ path: string; name: string }> => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return req('/api/hermes/stage', { method: 'POST', body: fd });
  },
  listHermesRoles: (): Promise<{ roles: { id: string; label: string }[] }> => req('/api/hermes/roles'),
  listTrash: (): Promise<{ items: { path: string; name: string; isDir: boolean; size: number; modifiedAt: string }[] }> => req('/api/trash'),
  trashPath: (path: string) => req('/api/trash', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) }),
  restoreFromTrash: (path: string) => req('/api/trash/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) }),
  deleteFromTrash: (path: string) => req('/api/trash', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) }),
  createFolder: (parentPath: string, name: string): Promise<{ path: string }> =>
    req('/api/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parentPath, name, kind: 'folder' }) }),
  createFile: (parentPath: string, name: string, content = ''): Promise<{ path: string }> =>
    req('/api/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parentPath, name, kind: 'file', content }) }),
  rename: (path: string, newName: string): Promise<{ path: string }> =>
    req('/api/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, newName }) }),
  copy: (paths: string[], target: string): Promise<{ created: string[] }> =>
    req('/api/copy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths, target }) }),
  move: (paths: string[], target: string): Promise<{ created: string[] }> =>
    req('/api/move', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths, target }) }),
  officeSession: (path: string, force = false): Promise<{ enabled: boolean; token?: string; key?: string; fileUrl?: string; callbackUrl?: string; engineUrl?: string; fileType?: string; title?: string; expiresAt?: string }> =>
    req(`/api/office/session?path=${encodeURIComponent(path)}${force ? '&force=1' : ''}`),
  endOfficeSession: (token: string): Promise<{ ok: boolean }> =>
    req('/api/office/session', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }), keepalive: true }),
};
