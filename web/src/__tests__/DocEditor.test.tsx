import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
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

  it('shows a locked message and reopens via force, evicting a stale lock', async () => {
    const officeSession = api.officeSession as unknown as ReturnType<typeof vi.fn>;
    officeSession
      .mockRejectedValueOnce(new Error('already being edited')) // first open → 409 locked
      .mockResolvedValueOnce({ enabled: true, token: 'tok-2', key: 'k', fileUrl: 'u', callbackUrl: 'c', engineUrl: 'https://doc.example', fileType: 'word', fileExt: 'docx' });
    render(<DocEditor path="Documents/a.docx" name="a.docx" onSaved={() => {}} />);
    // A stale lock is distinguished from a disabled engine.
    expect(await screen.findByText(/open in another window|previous session didn't close/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/reopen anyway/i));
    expect(officeSession).toHaveBeenLastCalledWith('Documents/a.docx', true);
    await act(async () => {});
    // force succeeded → the editor is ready and the locked message is gone.
    expect(screen.queryByText(/reopen anyway/i)).toBeNull();
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

  // On a phone the engine gets its phone layout; elsewhere the desktop one. The
  // phone layout's fixed iframe is separately pinned under the bar (see the
  // engine-lifecycle block) so the bar's Back / ▾ buttons stay usable.
  it('asks the engine for its phone layout on a phone, desktop otherwise', () => {
    const session = { enabled: true, key: 'k', fileUrl: 'u', callbackUrl: 'c', fileType: 'word', fileExt: 'docx' };
    const phone = buildEditorConfig(session, 'a.docx', () => {}, true) as { type: string };
    const desktop = buildEditorConfig(session, 'a.docx', () => {}, false) as { type: string };
    expect(phone.type).toBe('mobile');
    expect(desktop.type).toBe('desktop');
  });

  // Regression: this was sent as `editorConfig.custom`, which is not a field the
  // engine knows, so it was silently dropped and autosave never actually applied.
  it('puts autosave under editorConfig.customization, the name the engine reads', () => {
    const cfg = buildEditorConfig(
      { enabled: true, key: 'k', fileUrl: 'u', callbackUrl: 'c', fileType: 'word', fileExt: 'docx' },
      'a.docx', () => {},
    ) as { editorConfig: { customization?: { autosave?: boolean }; custom?: unknown } };
    expect(cfg.editorConfig.customization?.autosave).toBe(true);
    expect(cfg.editorConfig.custom).toBeUndefined();
  });
});

describe('DocEditor engine lifecycle', () => {
  const ready = {
    enabled: true, token: 'tok', key: 'k', fileUrl: 'u', callbackUrl: 'c',
    engineUrl: 'https://doc.example', fileType: 'word', fileExt: 'docx',
  };

  afterEach(() => {
    (api.officeSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.endOfficeSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    delete window.DocsAPI;
    document.querySelectorAll('script[src*="api/documents/api.js"]').forEach((s) => s.remove());
    cleanup();
  });

  // Leaving the editor instance alive after the view is gone is what keeps the
  // keyboard coming back on a phone: its listeners outlive the screen that owned
  // them, so later taps anywhere still reach a destroyed editor's input.
  it('destroys the editor instance on unmount, not just the script tag', async () => {
    (api.officeSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(ready);
    const destroyEditor = vi.fn();
    window.DocsAPI = { DocEditor: vi.fn(() => ({ destroyEditor })) as never };

    const { unmount } = render(<DocEditor path="Documents/a.docx" name="a.docx" onSaved={() => {}} />);
    await act(async () => {});
    unmount();

    expect(destroyEditor).toHaveBeenCalled();
  });

  // The loader is served no-store, so re-adding the tag re-downloads ~65KB on
  // every open even though the global it defines is still there from last time.
  it('reuses an already-loaded DocsAPI instead of re-fetching the loader', async () => {
    (api.officeSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(ready);
    const DocEditorCtor = vi.fn(() => ({ destroyEditor: vi.fn() }));
    window.DocsAPI = { DocEditor: DocEditorCtor as never };

    render(<DocEditor path="Documents/a.docx" name="a.docx" onSaved={() => {}} />);
    await act(async () => {});

    expect(document.querySelectorAll('script[src*="api/documents/api.js"]').length).toBe(0);
    expect(DocEditorCtor).toHaveBeenCalled();
  });

  // The editor is expensive to build and holds the user's cursor and undo history.
  // Its owner passes a fresh `onSaved` closure on every render, so keying the engine
  // lifecycle to that identity tore down and rebuilt a live editor for nothing.
  it('keeps one live editor across parent re-renders that pass a new onSaved', async () => {
    (api.officeSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(ready);
    const destroyEditor = vi.fn();
    const DocEditorCtor = vi.fn(() => ({ destroyEditor }));
    window.DocsAPI = { DocEditor: DocEditorCtor as never };

    const { rerender } = render(<DocEditor path="Documents/a.docx" name="a.docx" onSaved={() => {}} />);
    await act(async () => {});
    expect(DocEditorCtor).toHaveBeenCalledTimes(1);

    // A new closure, exactly as the parent hands down on each render.
    rerender(<DocEditor path="Documents/a.docx" name="a.docx" onSaved={() => {}} />);
    await act(async () => {});

    expect(destroyEditor).not.toHaveBeenCalled();
    expect(DocEditorCtor).toHaveBeenCalledTimes(1);
  });

  // The engine gets a stable callback, so a save still reaches whichever handler
  // the parent most recently passed.
  it('pins the mobile engine\'s fixed iframe back into the container so the top bar stays usable', async () => {
    (api.officeSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(ready);
    // Mirror what the real api.js does on a phone: replace #placeholder with an
    // iframe that is `position: fixed` and sized 100% of the viewport, no insets.
    window.DocsAPI = {
      DocEditor: vi.fn(() => {
        const ph = document.getElementById('placeholder')!;
        const frame = document.createElement('iframe');
        frame.style.position = 'fixed';
        frame.style.width = '100%';
        frame.style.height = '100%';
        ph.parentElement!.replaceChild(frame, ph);
        return { destroyEditor: vi.fn() };
      }) as never,
    };
    // jsdom reports zeroed boxes; give the container the box it has on a phone.
    const rect = vi.fn().mockReturnValue({ top: 125, left: 25, width: 340, height: 694 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(rect as never);
    const roCallbacks: Array<() => void> = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { roCallbacks.push(cb); }
      observe() {} unobserve() {} disconnect() {}
    });

    render(<DocEditor path="Documents/a.docx" name="a.docx" onSaved={() => {}} />);
    await act(async () => {});

    const frame = document.querySelector('.viewer-body iframe') as HTMLIFrameElement | null;
    expect(frame).toBeTruthy();
    // Pinned to the container box instead of covering the viewport (and the bar).
    expect(frame?.style.top).toBe('125px');
    expect(frame?.style.left).toBe('25px');
    expect(frame?.style.width).toBe('340px');
    expect(frame?.style.height).toBe('694px');

    // Rotation: the container box changes, the pin must follow it.
    rect.mockReturnValue({ top: 0, left: 0, width: 844, height: 390 });
    roCallbacks.forEach((cb) => act(() => cb()));
    expect(frame?.style.top).toBe('0px');
    expect(frame?.style.width).toBe('844px');
    vi.restoreAllMocks();
  });

  it('leaves the desktop (in-flow) editor iframe alone', async () => {
    (api.officeSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(ready);
    window.DocsAPI = {
      DocEditor: vi.fn(() => {
        const ph = document.getElementById('placeholder')!;
        const frame = document.createElement('iframe'); // in-flow, like the desktop engine
        frame.style.width = '100%';
        frame.style.height = '100%';
        ph.parentElement!.replaceChild(frame, ph);
        return { destroyEditor: vi.fn() };
      }) as never,
    };
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

    render(<DocEditor path="Documents/a.docx" name="a.docx" onSaved={() => {}} />);
    await act(async () => {});

    const frame = document.querySelector('.viewer-body iframe') as HTMLIFrameElement | null;
    expect(frame?.style.top).toBe('');
    expect(frame?.style.left).toBe('');
    vi.restoreAllMocks();
  });

  it('routes onSave to the latest handler without rebuilding the editor', async () => {
    (api.officeSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(ready);
    let captured: (() => void) | undefined;
    window.DocsAPI = {
      DocEditor: vi.fn((_id: string, cfg: unknown) => {
        captured = (cfg as { events: { onSave: () => void } }).events.onSave;
        return { destroyEditor: vi.fn() };
      }) as never,
    };
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = render(<DocEditor path="Documents/a.docx" name="a.docx" onSaved={first} />);
    await act(async () => {});
    rerender(<DocEditor path="Documents/a.docx" name="a.docx" onSaved={second} />);
    await act(async () => {});

    captured?.();
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });
});
