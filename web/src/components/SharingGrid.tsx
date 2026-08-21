import { KINDS, type FileItem, type Kind } from '@privy/shared';
import { api } from '../api';

const ICON: Record<Kind, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.icon])) as Record<Kind, string>;
const LABEL: Record<Kind, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.label])) as Record<Kind, string>;

/** Images get a real thumbnail (HEIC via its proxy, JPEG/PNG via the file URL).
 *  Videos keep an icon — a proxy is an mp4, which an <img> can't render. */
const thumbUrl = (item: FileItem): string => (item.hasProxy ? api.proxyUrl(item.path) : api.fileUrl(item.path));
const showThumb = (item: FileItem): boolean => item.kind === 'image';

function fmtSize(n: number): string {
  if (n === 0) return 'folder';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function SharingGrid({ items, onSelect, emptyMessage }: { items: FileItem[]; onSelect: (item: FileItem) => void; emptyMessage?: string }) {
  if (items.length === 0) return <div className="empty-state">{emptyMessage ?? 'Nothing here yet — send something from the chat.'}</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
      {items.map((item) => (
        <button key={item.path} className="tile" onClick={() => onSelect(item)} title={item.isDir ? `Open ${item.name}` : item.name}>
          <div className="tile-icon">{showThumb(item) ? <img src={thumbUrl(item)} alt="" className="tile-thumb" loading="lazy" /> : ICON[item.kind]}</div>
          <div className="tile-name">{item.name}{item.isDir ? ' ›' : ''}</div>
          <div className="tile-meta">{fmtSize(item.size)} · {LABEL[item.kind]}</div>
        </button>
      ))}
    </div>
  );
}
