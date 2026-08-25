import { render, screen, cleanup, act } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { DocEditor, buildEditorConfig } from '../components/DocEditor';
import { api } from '../api';

vi.mock('../api', async () => {
  const actual = (await vi.importActual('../api')) as typeof import('../api');
  return { api: { ...actual.api, officeSession: vi.fn(), endOfficeSession: vi.fn() }, API_BASE: actual.API_BASE };
});
import { getToken } from '../auth';
vi.mock('../auth', () => ({ getToken: () => '' }));

describe('DocEditor', () => {
  afterEach(() => {
    (api.officeSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.endOfficeSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    cleanup();
  });

  it('releases the office lock on unmount, so a reopened file is not "already being edited"', async () => {
    (api.officeSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      enabled: true, token: 'tok-1', key: 'k', fileUrl: 'http://host/f', callbackUrl: 'http://host/c',
      engineUrl: 'https://doc.example', fileType: 'word', fileExt: 'docx',
    });
    const { unmount } = render(<DocEditor path="Documents/a.docx" name="a.docx" onSaved={() => {}} />);
    // Flush the microtask so the officeSession .then sets tokenRef before unmount.
    await act(async () => {});
    unmount();
    expect(api.endOfficeSession).toHaveBeenCalledWith('tok-1');
  });

  it('shows a download fallback when the engine is disabled', async () => {
    (api.officeSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ enabled: false });
    render(<DocEditor path="Documents/a.docx" name="a.docx" onSaved={() => {}} />);
    expect(await screen.findByText(/Editor unavailable/)).toBeTruthy();
  });

  it('sends the real extension as document.fileType and the kind as top-level documentType', () => {
    const cfg = buildEditorConfig(
      { enabled: true, key: 'k', fileUrl: 'http://host/file', callbackUrl: 'http://host/cb', fileType: 'word', fileExt: 'docx' },
      'Document.docx', () => {},
    ) as { document: { fileType: string }; documentType: string; editorConfig: { callbackUrl: string }; type: string };
    // Regression: the engine rejects editor-type tags in document.fileType.
    expect(cfg.document.fileType).toBe('docx');
    expect(cfg.documentType).toBe('word');
    expect(cfg.editorConfig.callbackUrl).toBe('http://host/cb');
    expect(cfg.type).toBe('desktop');
  });

  it('falls back to the extension derived from name when the session omits fileExt', () => {
    const cfg = buildEditorConfig(
      { enabled: true, key: 'k', fileUrl: 'u', callbackUrl: 'c', fileType: 'slide' },
      'deck.pptx', () => {},
    ) as { document: { fileType: string }; documentType: string };
    expect(cfg.document.fileType).toBe('pptx');
    expect(cfg.documentType).toBe('slide');
  });
});
