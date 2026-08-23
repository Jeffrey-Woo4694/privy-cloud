import { describe, expect, it } from 'vitest';
import { editorFor } from '../fileEditor';

describe('editorFor', () => {
  it('routes office extensions (and not Keynote)', () => {
    expect(editorFor('report.DOCX')).toBe('office');
    expect(editorFor('book.xlsx')).toBe('office');
    expect(editorFor('deck.ppt')).toBe('office');
    expect(editorFor('slide.key')).toBe('none'); // Keynote: download fallback
  });
  it('routes text, structured, markdown', () => {
    expect(editorFor('a.tsx')).toBe('text');
    expect(editorFor('data.csv')).toBe('structured');
    expect(editorFor('config.yaml')).toBe('structured');
    expect(editorFor('note.md')).toBe('markdown');
  });
  it('routes media, archive, pdf', () => {
    expect(editorFor('song.mp3')).toBe('audio');
    expect(editorFor('bundle.zip')).toBe('archive');
    expect(editorFor('a.tar.gz')).toBe('archive');
    expect(editorFor('doc.pdf')).toBe('pdf');
  });
});
