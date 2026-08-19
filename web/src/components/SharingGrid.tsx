import { KINDS, type FileItem, type Kind } from '@privy/shared';

const ICON: Record<Kind, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.icon])) as Record<Kind, string>;
const LABEL: Record<Kind, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.label])) as Record<Kind, string>;

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
          <div className="tile-icon">{ICON[item.kind]}</div>
          <div className="tile-name">{item.name}{item.isDir ? ' ›' : ''}</div>
          <div className="tile-meta">{fmtSize(item.size)} · {LABEL[item.kind]}</div>
        </button>
      ))}
    </div>
  );
}
