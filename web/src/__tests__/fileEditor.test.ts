import { describe, expect, it } from 'vitest';
import { editorFor } from '../fileEditor';

describe('editorFor', () => {
  it('routes office extensions (and not Keynote)', () => {
    expect(editorFor('report.DOCX')).toBe('office');
    expect(editorFor('book.xlsx')).toBe('office');
    expect(editorFor('deck.ppt')).toBe('office');
    expect(editorFor('slide.key')).toBe('none'); // Keynote: download fallback
  });
  it('routes code source files to the code viewer', () => {
    expect(editorFor('main.cpp')).toBe('code');
    expect(editorFor('Foo.java')).toBe('code');
    expect(editorFor('app.py')).toBe('code');
    expect(editorFor('a.tsx')).toBe('code');
    expect(editorFor('util.js')).toBe('code');
  });
  it('routes markup, style and bytecode-ish files to the code viewer', () => {
    expect(editorFor('index.html')).toBe('code');
    expect(editorFor('style.css')).toBe('code');
    expect(editorFor('site.scss')).toBe('code');
    expect(editorFor('Widget.vue')).toBe('code');
    expect(editorFor('Foo.class')).toBe('code');
    expect(editorFor('Dockerfile')).toBe('code');
  });
  it('routes non-code text, structured, markdown', () => {
    expect(editorFor('readme.txt')).toBe('text');
    expect(editorFor('app.log')).toBe('text');
    expect(editorFor('app.ini')).toBe('text');
    expect(editorFor('data.csv')).toBe('office'); // CSV opens in the OnlyOffice cell editor
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
