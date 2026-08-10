import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileViewer } from '../components/FileViewer';
import { api } from '../api';
import type { FileItem } from '@privy/shared';

vi.mock('../api', () => ({
  API_BASE: 'http://test',
  api: { getFileText: vi.fn(), saveFileText: vi.fn() },
}));

const md: FileItem = { name: 'n.md', path: 'Markdown/n.md', kind: 'markdown', size: 1, isDir: false, modifiedAt: 'x' };
const img: FileItem = { name: 'p.png', path: 'Images/p.png', kind: 'image', size: 1, isDir: false, modifiedAt: 'x' };

describe('FileViewer', () => {
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
    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://test/api/file?path=Images%2Fp.png');
  });
});
