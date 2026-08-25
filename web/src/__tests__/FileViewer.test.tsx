import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileViewer } from '../components/FileViewer';
import { api } from '../api';
import type { FileItem } from '@privy/shared';

vi.mock('../api', () => ({
  API_BASE: 'http://test',
  api: { getFileText: vi.fn(), saveFileText: vi.fn() },
}));
vi.mock('../components/DocEditor', () => ({ DocEditor: () => <div data-testid="doc" /> }));
vi.mock('../components/AudioPlayer', () => ({ AudioPlayer: () => <div data-testid="audio" /> }));
vi.mock('../components/CodeViewer', () => ({ CodeViewer: () => <div data-testid="codeviewer" /> }));

const md: FileItem = { name: 'n.md', path: 'Markdown/n.md', kind: 'markdown', size: 1, isDir: false, modifiedAt: 'x' };
const img: FileItem = { name: 'p.png', path: 'Images/p.png', kind: 'image', size: 1, isDir: false, modifiedAt: 'x' };
const docx: FileItem = { name: 'a.docx', path: 'Documents/a.docx', kind: 'document', size: 1, isDir: false, modifiedAt: 'x' };
const csv: FileItem = { name: 'a.csv', path: 'Docs/a.csv', kind: 'document', size: 1, isDir: false, modifiedAt: 'x' };
const mp3: FileItem = { name: 'a.mp3', path: 'Audio/a.mp3', kind: 'audio', size: 1, isDir: false, modifiedAt: 'x' };
const cpp: FileItem = { name: 'main.cpp', path: 'Code/main.cpp', kind: 'other', size: 1, isDir: false, modifiedAt: 'x' };

describe('FileViewer', () => {
  beforeEach(() => localStorage.clear());
  it('renders a markdown preview, then edits it after clicking Edit', async () => {
    (api.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue('# hi');
    const onSaved = vi.fn();
    render(<FileViewer item={md} onBack={vi.fn()} onSaved={onSaved} />);
    // Rendered preview shows the formatted heading by default.
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('hi'));
    // Switch to the raw editor, then edit + save.
    fireEvent.click(screen.getByRole('button', { name: /edit as markdown/i }));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('# hi'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# bye' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(api.saveFileText).toHaveBeenCalledWith('Markdown/n.md', '# bye'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('renders an image with the file URL', () => {
    render(<FileViewer item={img} onBack={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://test/api/file?path=Images%2Fp.png&token=');
  });

  it('includes the token on media URLs when present', () => {
    localStorage.setItem('privy-token', 't');
    render(<FileViewer item={img} onBack={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://test/api/file?path=Images%2Fp.png&token=t');
  });

  it('renders the office editor via DocEditor for a docx item', () => {
    render(<FileViewer item={docx} onBack={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByTestId('doc')).toBeTruthy();
  });

  it('renders the structured viewer for a csv item', async () => {
    (api.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue('x,y\n1,2');
    render(<FileViewer item={csv} onBack={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('x')).toBeTruthy());
    expect(screen.getByText('1')).toBeTruthy();
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

  it('shows an Expand button for an office item and toggles fullscreen', () => {
    const { container } = render(<FileViewer item={docx} onBack={vi.fn()} onSaved={vi.fn()} />);
    const viewer = container.querySelector('.viewer') as HTMLElement;
    expect(viewer.className).not.toContain('viewer-fullscreen');
    expect(screen.getByRole('button', { name: /expand/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /expand/i }));
    expect(viewer.className).toContain('viewer-fullscreen');

    fireEvent.click(screen.getByRole('button', { name: /fullscreen/i }));
    expect(viewer.className).not.toContain('viewer-fullscreen');
  });

  it('shows an Expand button for a markdown item (editable view)', () => {
    (api.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue('# hi');
    render(<FileViewer item={md} onBack={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole('button', { name: /expand/i })).toBeTruthy();
  });

  it('hides the Expand button for a non-editable view (image)', () => {
    render(<FileViewer item={img} onBack={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /expand/i })).toBeNull();
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

  it('ignores F2 for a non-editable view (image)', () => {
    const { container } = render(<FileViewer item={img} onBack={vi.fn()} onSaved={vi.fn()} />);
    const viewer = container.querySelector('.viewer') as HTMLElement;
    fireEvent.keyDown(window, { key: 'F2' });
    expect(viewer.className).not.toContain('viewer-fullscreen');
  });
});
