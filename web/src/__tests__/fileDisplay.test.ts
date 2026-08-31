import { describe, expect, it } from 'vitest';
import { truncatedName } from '../fileDisplay';

describe('truncatedName', () => {
  it('leaves short names untouched', () => {
    expect(truncatedName('notes.md', false)).toBe('notes.md');
    expect(truncatedName('exactly-thirty-two-characters.', false)).toBe('exactly-thirty-two-characters.');
  });

  it('middle-truncates long names, keeping the file type visible', () => {
    const out = truncatedName('message-from-iphone-20260831-231803.md', false);
    expect(out.length).toBeLessThanOrEqual(32);
    expect(out).toMatch(/…md$/); // ellipsis glued to the bare type (no dot — the tile rule)
  });

  it('applies the same rule to directories (no type suffix) and hidden files', () => {
    expect(truncatedName('a-really-long-folder-name-indeed-extra', true)).toMatch(/…$/);
    expect(truncatedName('.gitignore-config-file-name-long', false).includes('.')).toBe(true);
    // A hidden file (dot at index 0) has no trailing type to protect, so the
    // whole name truncates with a plain trailing ellipsis.
    expect(truncatedName('.config-for-the-entire-project-long', false)).toMatch(/…$/);
  });

  it('honors a custom budget', () => {
    const out = truncatedName('document-final-version-2.md', false, 16);
    expect(out.length).toBeLessThanOrEqual(16);
    expect(out).toMatch(/…md$/);
  });

  it('never returns something longer than the name it replaced', () => {
    const names = ['a.md', 'ab.cd', 'x'.repeat(50) + '.md', 'no-extension-here-at-all-really'];
    for (const n of names) expect(truncatedName(n, false).length).toBeLessThanOrEqual(Math.max(n.length, 32));
  });
});
