export const OFFICE_EDITABLE_EXT = new Set([
  'doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp',
]);

export const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'log', 'csv', 'json', 'xml', 'yaml', 'yml',
  'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'sh', 'sql', 'ini', 'toml',
  'conf', 'env', 'gitignore', 'jsonl',
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
