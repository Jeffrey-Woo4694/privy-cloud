// Turn an HTML5 drag/drop `DataTransfer` into a normalized upload payload.
// The sharing grid needs `{ base, rel }` (drop into the current folder); the chat
// reuses the same payload for `onSendFiles` (loose files) and `onSendFolder`
// (directories, via webkitRelativePath). A dropped directory is walked with
// `webkitGetAsEntry()` — a `webkitdirectory` <input> doesn't apply to drops, and
// dropping a folder flattens `DataTransfer.files` (structure lost), so it must be
// reconstructed here.

export interface DropItem {
  /** The dropped directory's name, '' for a loose file. */
  base: string;
  /** The file's path beneath `base` ('' for a loose file → just the file name). */
  rel: string;
  file: File;
}

// Minimal structural types so the DOM types (FileSystemEntry etc.) and unit-test
// fakes both satisfy the same shape, and the function stays jsdom-testable.
export interface EntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?(cb: (f: File) => void, err?: (e: unknown) => void): void;
  createReader?(): { readEntries(cb: (e: EntryLike[]) => void, err?: (e: unknown) => void): void };
}
export interface ItemLike {
  kind: string;
  webkitGetAsEntry?(): EntryLike | null;
  getAsFile?(): File | null;
}
export interface DropData {
  items: ArrayLike<ItemLike>;
  files: ArrayLike<File>;
}

/** Group drop items by destination: loose files (`base ''`) and one File[] per directory. */
export function partitionDrop(items: DropItem[]): { files: File[]; folders: File[][] } {
  const files: File[] = [];
  const groups = new Map<string, File[]>();
  for (const it of items) {
    if (it.base) {
      const g = groups.get(it.base) ?? [];
      g.push(it.file);
      groups.set(it.base, g);
    } else files.push(it.file);
  }
  return { files, folders: [...groups.values()] };
}

/** The reader yields entries in batches; drain until an empty batch signals the end. */
function readEntries(dir: EntryLike): Promise<EntryLike[]> {
  const reader = dir.createReader!();
  const out: EntryLike[] = [];
  return new Promise((resolve, reject) => {
    const next = () => reader.readEntries((batch) => {
      if (batch.length === 0) return resolve(out);
      out.push(...batch);
      next();
    }, reject);
    next();
  });
}

function entryFile(entry: EntryLike): Promise<File> {
  return new Promise((resolve, reject) => (entry.file ? entry.file(resolve, reject) : reject(new Error('no file()'))));
}

/** Ensure `file.webkitRelativePath` carries the structure the folder-upload needs. */
function withRel(file: File, path: string): File {
  try { Object.defineProperty(file, 'webkitRelativePath', { value: path, writable: true, configurable: true }); }
  catch { /* some browsers expose it as a getter; entry.file() already set it */ }
  return file;
}

async function walkDir(dir: EntryLike, base: string, prefix: string, out: DropItem[]): Promise<void> {
  for (const e of await readEntries(dir)) {
    if (e.isFile) {
      const file = await entryFile(e);
      const rel = prefix + e.name;
      out.push({ base, rel, file: withRel(file, `${base}/${rel}`) });
    } else if (e.isDirectory) {
      await walkDir(e, base, prefix + e.name + '/', out);
    }
  }
}

/**
 * Parse a drop into upload items. Prefers `webkitGetAsEntry()` (so a dropped folder
 * keeps its structure); falls back to `getAsFile()` per item, then to `DataTransfer.files`
 * when entries are unsupported. Loose files get `base:''`; directory contents get the
 * directory's name as `base` and their path beneath it as `rel`.
 */
export async function parseDrop(dt: DropData): Promise<DropItem[]> {
  const out: DropItem[] = [];
  let used = false;
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry) {
      used = true;
      if (entry.isDirectory) await walkDir(entry, entry.name, '', out);
      else { const file = await entryFile(entry); out.push({ base: '', rel: file.name, file }); }
    } else {
      const file = item.getAsFile ? item.getAsFile() : null;
      if (file) { used = true; out.push({ base: '', rel: file.name, file }); }
    }
  }
  if (!used) {
    for (const file of Array.from(dt.files ?? [])) out.push({ base: '', rel: file.name, file });
  }
  return out;
}
