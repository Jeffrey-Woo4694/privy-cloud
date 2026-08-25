export const OFFICE_EDITABLE_EXT = new Set([
  'doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp',
]);

export const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'log', 'csv', 'json', 'xml', 'yaml', 'yml',
  'ini', 'toml', 'conf', 'env', 'gitignore', 'jsonl',
  // Code source / markup / style files: the CodeViewer's Edit toggle saves back through
  // PUT /api/file, so these must be accepted as editable text. Keep in sync with the
  // web fileEditor.ts CODE set.
  'c', 'h', 'cc', 'cpp', 'cxx', 'hh', 'hpp', 'hxx', 'm', 'mm',
  'java', 'class', 'jsp', 'cs', 'go', 'rs', 'rb', 'php', 'py', 'pyi',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'sh', 'bash', 'zsh', 'fish',
  'sql', 'swift', 'kt', 'kts', 'scala', 'groovy', 'dart', 'lua', 'pl', 'pm', 'r',
  'pas', 'vb', 'vbs', 'fs', 'fsx', 'cls', 'asm', 's', 'zig', 'nim', 'hs',
  'ex', 'exs', 'erl', 'hrl', 'ml', 'mli', 'clj', 'cljs', 'el', 'rkt',
  'html', 'htm', 'xhtml', 'css', 'scss', 'less', 'sass', 'styl', 'vue', 'svelte',
  'astro', 'hbs', 'ejs', 'tpl', 'liquid', 'razor', 'cshtml', 'mdx', 'jsonc',
  'graphql', 'gql', 'proto', 'thrift',
  'cmake', 'gradle', 'properties', 'tf', 'tfvars', 'hcl', 'nix', 'dhall', 'plist',
  'dockerfile', 'makefile', 'rakefile', 'gemfile', 'procfile',
]);

export function extOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.tar.gz')) return 'gz'; // treat compound archives by their final ext
  return lower.split('.').pop() ?? '';
}

export function isOfficeEditable(name: string): boolean {
  return OFFICE_EDITABLE_EXT.has(extOf(name));
}

export function isTextEditable(name: string): boolean {
  return TEXT_EXTENSIONS.has(extOf(name));
}

export function officeFileType(ext: string): 'word' | 'cell' | 'slide' | null {
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'word';
  if (['xls', 'xlsx', 'ods'].includes(ext)) return 'cell';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return 'slide';
  return null;
}
