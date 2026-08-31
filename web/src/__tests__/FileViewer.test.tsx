import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { FileViewer } from '../components/FileViewer';
import { api } from '../api';
import type { FileItem } from '@privy/shared';

vi.mock('../api', () => ({
  API_BASE: 'http://test',
  api: {
    getFileText: vi.fn(),
    saveFileText: vi.fn(),
    proxyUrl: (p: string) => `http://test/api/proxy?path=${encodeURIComponent(p)}`,
  },
}));
vi.mock('../components/DocEditor', () => ({ DocEditor: () => <div data-testid="doc" /> }));
vi.mock('../components/AudioPlayer', () => ({ AudioPlayer: () => <div data-testid="audio" /> }));
vi.mock('../components/CodeViewer', () => ({ CodeViewer: () => <div data-testid="codeviewer" /> }));

const md: FileItem = { name: 'n.md', path: 'Markdown/n.md', kind: 'markdown', size: 1, isDir: false, modifiedAt: 'x' };
const img: FileItem = { name: 'p.png', path: 'Pictures/p.png', kind: 'image', size: 1, isDir: false, modifiedAt: 'x' };
const docx: FileItem = { name: 'a.docx', path: 'Documents/a.docx', kind: 'document', size: 1, isDir: false, modifiedAt: 'x' };
const csv: FileItem = { name: 'a.csv', path: 'Docs/a.csv', kind: 'document', size: 1, isDir: false, modifiedAt: 'x' };
const mp3: FileItem = { name: 'a.mp3', path: 'Audio/a.mp3', kind: 'audio', size: 1, isDir: false, modifiedAt: 'x' };
const cpp: FileItem = { name: 'main.cpp', path: 'Code/main.cpp', kind: 'other', size: 1, isDir: false, modifiedAt: 'x' };
const vid: FileItem = { name: 'v.mov', path: 'Videos/v.mov', kind: 'video', size: 1, isDir: false, modifiedAt: 'x' };
const vidPending: FileItem = { ...vid, proxyPending: true };
const vidProxy: FileItem = { ...vid, hasProxy: true };

describe('FileViewer', () => {
  beforeEach(() => localStorage.clear());
  // The top bar's right side is one ▾ popover (like the sharing page's Create
  // button); tests open it to reach Download / Expand / Trash rows.
  const openActions = () => fireEvent.click(screen.getByRole('button', { name: /file actions/i }));

  it('renders a markdown design by default, edits the raw text, and shows the update', async () => {
    (api.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue('# hi');
    const onSaved = vi.fn();
    const { container } = render(<FileViewer item={md} onBack={vi.fn()} onSaved={onSaved} />);
    // The formatted design is the first face: a heading, and no textarea yet.
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('hi'), { timeout: 4000 });
    expect(container.querySelector('textarea')).toBeNull();
    // The single Edit/Show button swaps faces; its label flips.
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const area = await waitFor(() => container.querySelector('textarea')!);
    expect(area).toHaveValue('# hi');
    fireEvent.change(area, { target: { value: '# bye' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(api.saveFileText).toHaveBeenCalledWith('Markdown/n.md', '# bye'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // Back to the design, now reflecting the edit.
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('bye'), { timeout: 4000 });
  });

  it('truncates a long top-bar name middle-out, keeping the file type', async () => {
    (api.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue('hi');
    const long: FileItem = { ...md, name: 'message-from-iphone-20260831-231803.md', path: 'Markdown/message-from-iphone-20260831-231803.md' };
    render(<FileViewer item={long} onBack={vi.fn()} onSaved={vi.fn()} />);
    const barName = document.querySelector('.viewer-bar-name')!;
    expect(barName.getAttribute('title')).toBe(long.name); // full name still available (tooltip)
    expect(barName.textContent!.length).toBeLessThanOrEqual(32);
    expect(barName.textContent).toContain('…');
    expect(barName.textContent).toMatch(/…md$/); // the type survives the truncation
  });

  it('the actions popover offers Download for any file, not just media', async () => {
    (api.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue('# hi');
    render(<FileViewer item={md} onBack={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), { timeout: 4000 });
    openActions();
    const dl = screen.getByRole('menuitem', { name: /download/i });
    expect(dl.getAttribute('href')).toContain('/api/file?path=Markdown%2Fn.md');
    expect(dl.getAttribute('download')).toBe('n.md');
  });

  it('renaming via the editor name field asks the parent to move the file', async () => {
    (api.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue('# hi');
    const onRename = vi.fn().mockResolvedValue({ path: 'Markdown/renamed.md' });
    render(<FileViewer item={md} onBack={vi.fn()} onSaved={vi.fn()} onRename={onRename} />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), { timeout: 4000 });
    const nameField = screen.getByLabelText('File name');
    fireEvent.change(nameField, { target: { value: 'renamed.md' } });
    fireEvent.keyDown(nameField, { key: 'Enter' });
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Markdown/n.md', 'renamed.md'));
  });

  it('Escape closes the open actions popover before it closes anything else', () => {
    const onBack = vi.fn();
    render(<FileViewer item={img} onBack={onBack} onSaved={vi.fn()} />);
    openActions();
    expect(screen.getByRole('menuitem', { name: /download/i })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menuitem')).toBeNull(); // popover shut…
    expect(onBack).not.toHaveBeenCalled(); // …viewer untouched
  });


  it('renders an image with the file URL', () => {
    render(<FileViewer item={img} onBack={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://test/api/file?path=Pictures%2Fp.png&token=');
  });

  it('includes the token on media URLs when present', () => {
    localStorage.setItem('privy-token', 't');
    render(<FileViewer item={img} onBack={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://test/api/file?path=Pictures%2Fp.png&token=t');
  });

  it('renders the office editor via DocEditor for a docx item', () => {
    render(<FileViewer item={docx} onBack={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByTestId('doc')).toBeTruthy();
  });

  it('renders the office editor via DocEditor for a csv item', () => {
    render(<FileViewer item={csv} onBack={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByTestId('doc')).toBeTruthy();
  });

  it('renders the code viewer for a code item', async () => {
    (api.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue('int main() {}\n');
    render(<FileViewer item={cpp} onBack={vi.fn()} onSaved={vi.fn()} />);
    expect(await screen.findByTestId('codeviewer')).toBeTruthy();
  });

  it('renders the audio player for an mp3 item', () => {
    render(<FileViewer item={mp3} onBack={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByTestId('audio')).toBeTruthy();
  });

  it('the actions menu expands an office item to fullscreen and back', () => {
    const { container } = render(<FileViewer item={docx} onBack={vi.fn()} onSaved={vi.fn()} />);
    const viewer = container.querySelector('.viewer') as HTMLElement;
    expect(viewer.className).not.toContain('viewer-fullscreen');
    openActions();
    fireEvent.click(screen.getByRole('menuitem', { name: /^expand$/i }));
    expect(viewer.className).toContain('viewer-fullscreen');
    openActions();
    fireEvent.click(screen.getByRole('menuitem', { name: /exit fullscreen/i }));
    expect(viewer.className).not.toContain('viewer-fullscreen');
  });

  it('the actions menu offers Expand for a markdown item (editable view)', async () => {
    (api.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue('# hi');
    render(<FileViewer item={md} onBack={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(), { timeout: 4000 });
    openActions();
    expect(screen.getByRole('menuitem', { name: /^expand$/i })).toBeTruthy();
  });

  it('the actions menu offers Expand for every view, including media (image)', () => {
    render(<FileViewer item={img} onBack={vi.fn()} onSaved={vi.fn()} />);
    openActions();
    expect(screen.getByRole('menuitem', { name: /^expand$/i })).toBeTruthy();
  });

  it('F2 toggles fullscreen (expand then exit) and Esc exits', () => {
    const { container } = render(<FileViewer item={docx} onBack={vi.fn()} onSaved={vi.fn()} />);
    const viewer = container.querySelector('.viewer') as HTMLElement;
    expect(viewer.className).not.toContain('viewer-fullscreen');
    // F2 expands.
    fireEvent.keyDown(window, { key: 'F2' });
    expect(viewer.className).toContain('viewer-fullscreen');
    // F2 again exits.
    fireEvent.keyDown(window, { key: 'F2' });
    expect(viewer.className).not.toContain('viewer-fullscreen');
    // F2 expands; Esc always exits.
    fireEvent.keyDown(window, { key: 'F2' });
    expect(viewer.className).toContain('viewer-fullscreen');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(viewer.className).not.toContain('viewer-fullscreen');
  });

  it('F2 expands a media view (image) to fullscreen', () => {
    const { container } = render(<FileViewer item={img} onBack={vi.fn()} onSaved={vi.fn()} />);
    const viewer = container.querySelector('.viewer') as HTMLElement;
    fireEvent.keyDown(window, { key: 'F2' });
    expect(viewer.className).toContain('viewer-fullscreen');
    // The menu now offers Exit fullscreen and the toggle still works.
    openActions();
    fireEvent.click(screen.getByRole('menuitem', { name: /exit fullscreen/i }));
    expect(viewer.className).not.toContain('viewer-fullscreen');
  });

  it('consumes an Escape it handled so background window listeners never see it', () => {
    // Regression: one Esc closed the viewer AND leaked (window bubble) to the grid's
    // Escape shortcut (goBack), popping the browse path a directory above the file.
    const onBack = vi.fn();
    render(<FileViewer item={img} onBack={onBack} onSaved={vi.fn()} />);
    const spy = vi.fn();
    window.addEventListener('keydown', spy); // bubble phase, like PrivyCloudTab's grid shortcuts
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    window.removeEventListener('keydown', spy);
    expect(onBack).toHaveBeenCalled(); // the viewer consumed the keystroke…
    expect(spy).not.toHaveBeenCalled(); // …and it did not reach the rest of the app
  });

  it('Esc inside the editing surface closes the file back to its folder (autosave keeps the edit)', async () => {
    (api.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue('# hi');
    const onBack = vi.fn();
    const { container } = render(<FileViewer item={md} onBack={onBack} onSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const box = (await waitFor(() => container.querySelector('textarea')!)) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '# changed' } });
    fireEvent.keyDown(box, { key: 'Escape' }); // focus was inside the editor textarea
    expect(onBack).toHaveBeenCalled();
  });

  it('Esc while typing OUTSIDE the viewer (e.g. the chat box) does not close the file', async () => {
    (api.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue('# hi');
    const onBack = vi.fn();
    const { container } = render(
      <>
        <FileViewer item={md} onBack={onBack} onSaved={vi.fn()} />
        <textarea data-testid="chat-input" />
      </>,
    );
    const chat = container.querySelector('[data-testid="chat-input"]') as HTMLTextAreaElement;
    fireEvent.keyDown(chat, { key: 'Escape' });
    expect(onBack).not.toHaveBeenCalled();
  });

  it('a failed video preview offers Retry, which remounts a fresh media element', () => {
    render(<FileViewer item={vid} onBack={vi.fn()} onSaved={vi.fn()} />);
    const v1 = document.querySelector('video') as HTMLVideoElement;
    fireEvent.error(v1);
    expect(screen.getByText(/Preview unavailable/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    const v2 = document.querySelector('video') as HTMLVideoElement;
    expect(v2).toBeTruthy();
    expect(v2).not.toBe(v1); // genuinely reloaded, not the errored node revived
  });

  it('a failed image preview offers Retry too (no more sticky dead end)', () => {
    render(<FileViewer item={img} onBack={vi.fn()} onSaved={vi.fn()} />);
    const i1 = document.querySelector('img') as HTMLImageElement;
    fireEvent.error(i1);
    expect(screen.getByText(/Preview unavailable/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    const i2 = document.querySelector('img') as HTMLImageElement;
    expect(i2).toBeTruthy();
    expect(i2).not.toBe(i1);
  });

  it('polls the parent while a video is transcoding, and stops once the proxy lands', () => {
    vi.useFakeTimers();
    try {
      const onRefreshItems = vi.fn();
      const { rerender } = render(
        <FileViewer item={vidPending} onBack={vi.fn()} onSaved={vi.fn()} onRefreshItems={onRefreshItems} />,
      );
      expect(screen.getByText(/Transcoding for preview/)).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(3000); });
      expect(onRefreshItems).toHaveBeenCalledTimes(1);
      // The parent refresh resolves the item with its proxy ready.
      rerender(
        <FileViewer item={vidProxy} onBack={vi.fn()} onSaved={vi.fn()} onRefreshItems={onRefreshItems} />,
      );
      onRefreshItems.mockClear();
      act(() => { vi.advanceTimersByTime(6000); });
      expect(onRefreshItems).not.toHaveBeenCalled(); // pending is gone → no more polling
      expect(document.querySelector('video')?.getAttribute('src')).toContain('/api/proxy');
    } finally {
      vi.useRealTimers();
    }
  });
});
