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

const md: FileItem = { name: 'n.md', path: 'Markdown/n.md', kind: 'markdown', size: 1, isDir: false, modifiedAt: 'x' };
const img: FileItem = { name: 'p.png', path: 'Images/p.png', kind: 'image', size: 1, isDir: false, modifiedAt: 'x' };
const docx: FileItem = { name: 'a.docx', path: 'Documents/a.docx', kind: 'document', size: 1, isDir: false, modifiedAt: 'x' };
const csv: FileItem = { name: 'a.csv', path: 'Docs/a.csv', kind: 'document', size: 1, isDir: false, modifiedAt: 'x' };
const mp3: FileItem = { name: 'a.mp3', path: 'Audio/a.mp3', kind: 'audio', size: 1, isDir: false, modifiedAt: 'x' };

describe('FileViewer', () => {
  beforeEach(() => localStorage.clear());
  it('edits markdown and saves', async () => {
    (api.getFileText as ReturnType<typeof vi.fn>).mockResolvedValue('# hi');
    const onSaved = vi.fn();
    render(<FileViewer item={md} onBack={vi.fn()} onSaved={onSaved} />);
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

  it('renders the audio player for an mp3 item', () => {
    render(<FileViewer item={mp3} onBack={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByTestId('audio')).toBeTruthy();
  });
});
