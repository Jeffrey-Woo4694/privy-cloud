import { api } from '../api';
import type { FileItem } from '@privy/shared';
export function ArchiveInfo({ item }: { item: FileItem }) {
  return (
    <div className="viewer-body">
      <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
        <div style={{ fontSize: 40 }}>🗜️</div>
        <p>{item.name} — {formatSize(item.size)}. Archives open in your system's extractor.</p>
        <a className="btn" href={api.fileUrl(item.path)} download={item.name}>Download</a>
      </div>
    </div>
  );
}
function formatSize(n: number) { return `${(n / 1024).toFixed(1)} KB`; }
