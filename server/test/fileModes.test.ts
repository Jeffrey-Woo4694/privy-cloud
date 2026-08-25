import { describe, expect, it } from 'vitest';
import { isOfficeEditable, isTextEditable, officeFileType, extOf } from '../src/fileModes.js';

describe('fileModes', () => {
  it('office set is exactly the engine-native formats', () => {
    expect(isOfficeEditable('report.docx')).toBe(true);
    expect(isOfficeEditable('book.xlsx')).toBe(true);
    expect(isOfficeEditable('slides.pptx')).toBe(true);
    expect(isOfficeEditable('deck.key')).toBe(false); // Keynote: download fallback
    expect(isOfficeEditable('note.md')).toBe(false);
  });
  it('text allowlist covers the safe text formats and excludes binaries', () => {
    expect(isTextEditable('data.csv')).toBe(true);
    expect(isTextEditable('app.tsx')).toBe(true);
    expect(isTextEditable('config.json')).toBe(true);
    expect(isTextEditable('image.png')).toBe(false);
    expect(isTextEditable('movie.mp4')).toBe(false);
  });
  it('code source files are editable as text so the code view can save', () => {
    expect(isTextEditable('main.cpp')).toBe(true);
    expect(isTextEditable('Foo.java')).toBe(true);
    expect(isTextEditable('app.py')).toBe(true);
    expect(isTextEditable('App.cs')).toBe(true);
    expect(isTextEditable('image.png')).toBe(false);
  });
  it('markup, style and build-manifest files are editable as text', () => {
    expect(isTextEditable('index.html')).toBe(true);
    expect(isTextEditable('style.css')).toBe(true);
    expect(isTextEditable('Widget.vue')).toBe(true);
    expect(isTextEditable('Dockerfile')).toBe(true);
    expect(isTextEditable('movie.mp4')).toBe(false);
  });
  it('officeFileType maps ext to word/cell/slide', () => {
    expect(officeFileType('docx')).toBe('word');
    expect(officeFileType('xlsx')).toBe('cell');
    expect(officeFileType('pptx')).toBe('slide');
    expect(officeFileType('pdf')).toBeNull();
  });
  it('extOf treats compound archives by their final ext', () => {
    expect(extOf('a.tar.gz')).toBe('gz');
  });
});
