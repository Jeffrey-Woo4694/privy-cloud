import type { ChatEntry, FileItem, Kind } from '@privy/shared';

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? 'http://localhost:5178';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listItems: (kind?: Kind): Promise<FileItem[]> => req(`/api/items${kind ? `?kind=${kind}` : ''}`),
  getFileText: (path: string): Promise<string> => fetch(`${API_BASE}/api/file?path=${encodeURIComponent(path)}`).then((r) => r.text()),
  saveFileText: (path: string, content: string) =>
    req(`/api/file?path=${encodeURIComponent(path)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) }),
  sendText: (text: string): Promise<{ entry: ChatEntry }> =>
    req('/api/send/text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }),
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
  getMeta: (): Promise<{ root: string; owner: string }> => req('/api/meta'),
  setRoot: (path: string): Promise<{ root: string }> =>
    req('/api/settings/root', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) }),
};
