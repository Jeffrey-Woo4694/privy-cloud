export type EditorMode = 'office' | 'text' | 'structured' | 'markdown' | 'audio' | 'archive' | 'pdf' | 'none';

const OFFICE = new Set(['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp']);
const TEXT = new Set(['txt', 'log', 'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'sh', 'sql', 'ini', 'toml', 'conf', 'env', 'gitignore', 'jsonl']);
const STRUCTURED = new Set(['csv', 'json', 'xml', 'yaml', 'yml']);
const AUDIO = new Set(['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a']);
const ARCHIVE = new Set(['zip', 'tar', 'gz', 'tgz']);

export function editorFor(name: string): EditorMode {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'archive';
  const ext = lower.split('.').pop() ?? '';
  if (OFFICE.has(ext)) return 'office';
  if (AUDIO.has(ext)) return 'audio';
  if (ARCHIVE.has(ext)) return 'archive';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (STRUCTURED.has(ext)) return 'structured';
  if (TEXT.has(ext)) return 'text';
  return 'none';
}
