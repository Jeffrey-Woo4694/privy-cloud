export type EditorMode = 'office' | 'text' | 'structured' | 'markdown' | 'code' | 'audio' | 'archive' | 'pdf' | 'none';

const OFFICE = new Set(['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp']);
// Source / markup / style files for the read-only highlighted viewer (CodeViewer).
// Spelling out many languages + their headers; a language lowlight doesn't know just
// renders plain, so a broad list only ever loses highlighting, never breaks viewing.
const CODE = new Set([
  // C/C++ family
  'c', 'h', 'cc', 'cpp', 'cxx', 'hh', 'hpp', 'hxx', 'm', 'mm',
  // JVM-ish, C#, Go, Rust, scripting
  'java', 'class', 'jsp', 'cs', 'go', 'rs', 'rb', 'php', 'py', 'pyi',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'sh', 'bash', 'zsh', 'fish',
  'sql', 'swift', 'kt', 'kts', 'scala', 'groovy', 'dart', 'lua', 'pl', 'pm', 'r',
  'pas', 'vb', 'vbs', 'fs', 'fsx', 'cls', 'asm', 's', 'zig', 'nim', 'hs',
  'ex', 'exs', 'erl', 'hrl', 'ml', 'mli', 'clj', 'cljs', 'el', 'rkt',
  // Markup / style / components
  'html', 'htm', 'xhtml', 'css', 'scss', 'less', 'sass', 'styl', 'vue', 'svelte',
  'astro', 'hbs', 'ejs', 'tpl', 'liquid', 'razor', 'cshtml', 'mdx', 'jsonc',
  'graphql', 'gql', 'proto', 'thrift',
  // Config / build / infra
  'cmake', 'gradle', 'properties', 'tf', 'tfvars', 'hcl', 'nix', 'dhall', 'plist',
  // Extension-less build manifests (editorFor falls back to the whole name)
  'dockerfile', 'makefile', 'rakefile', 'gemfile', 'procfile',
]);
// Plain text (not code): displayed in the simple textarea editor.
const TEXT = new Set(['txt', 'log', 'ini', 'toml', 'conf', 'env', 'gitignore', 'jsonl']);
const STRUCTURED = new Set(['json', 'xml', 'yaml', 'yml']);
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
  if (CODE.has(ext)) return 'code';
  if (TEXT.has(ext)) return 'text';
  return 'none';
}
