import { api } from '../api';
export function AudioPlayer({ path, name }: { path: string; name: string }) {
  return <div className="viewer-body"><audio controls src={api.fileUrl(path)} style={{ width: '100%' }}>Your browser does not support audio.</audio></div>;
}
