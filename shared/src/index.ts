export type Kind = 'image' | 'video' | 'slide' | 'document' | 'markdown' | 'folder' | 'other';

export interface KindMeta { key: Kind; label: string; icon: string; folder: string; extensions: string[] }

export const KINDS: KindMeta[] = [
  { key: 'image',    label: 'Images',    icon: '🖼️', folder: 'Images',    extensions: ['jpg','jpeg','png','gif','webp','svg','bmp','heic'] },
  { key: 'video',    label: 'Videos',    icon: '🎬', folder: 'Videos',    extensions: ['mp4','mov','webm','mkv','avi'] },
  { key: 'slide',    label: 'Slides',    icon: '📑', folder: 'Slides',    extensions: ['ppt','pptx','key','odp'] },
  { key: 'document', label: 'Documents', icon: '📄', folder: 'Documents', extensions: ['pdf','doc','docx','xls','xlsx','odt','csv','json','xml'] },
  { key: 'markdown', label: 'Markdown',  icon: '📝', folder: 'Markdown',  extensions: ['md','markdown','txt'] },
  { key: 'folder',   label: 'Folders',   icon: '📁', folder: 'Folders',   extensions: [] },
  { key: 'other',    label: 'Other',     icon: '📦', folder: 'Other',     extensions: [] },
];

export const KIND_FOLDER: Record<Kind, string> = Object.fromEntries(
  KINDS.map((k) => [k.key, k.folder]),
) as Record<Kind, string>;

export interface FileItem {
  name: string; path: string; kind: Kind; size: number; isDir: boolean; modifiedAt: string;
  hasProxy?: boolean;      // video/image: a browser-playable proxy exists
  proxyPending?: boolean;  // video/image: transcode to a playable proxy is in progress
}

export interface ChatEntry {
  id: string; ts: string;
  type: 'text' | 'file' | 'folder';
  kind: Kind | 'text';
  name: string;
  path?: string;
  text?: string;
  sender: string;
}
