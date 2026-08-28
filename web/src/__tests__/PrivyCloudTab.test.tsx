import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PrivyCloudTab } from '../pages/PrivyCloudTab';
import { api } from '../api';

vi.mock('../ws', () => ({ connect: vi.fn(() => () => {}) }));

const FIXTURE = [
  { name: 'Images', path: 'Images', kind: 'folder', size: 0, isDir: true, modifiedAt: '' },
  { name: 'Folders', path: 'Folders', kind: 'folder', size: 0, isDir: true, modifiedAt: '' },
  { name: 'a.png', path: 'Images/a.png', kind: 'image', size: 1, isDir: false, modifiedAt: '' },
  { name: 'sub', path: 'Images/sub', kind: 'folder', size: 0, isDir: true, modifiedAt: '' },
  { name: 'deep.txt', path: 'Images/sub/deep.txt', kind: 'document', size: 1, isDir: false, modifiedAt: '' },
];

vi.mock('../api', () => ({
  API_BASE: '',
  api: {
    listItems: vi.fn(() => Promise.resolve(FIXTURE)),
    listChat: vi.fn(() => Promise.resolve([])),
    sendText: vi.fn(() => Promise.resolve({})),
    sendFiles: vi.fn(() => Promise.resolve([])),
    sendFolder: vi.fn(() => Promise.resolve({})),
    getFileText: vi.fn(() => Promise.resolve('')),
    saveFileText: vi.fn(() => Promise.resolve({ ok: true })),
    proxyUrl: (p: string) => p,
    fileUrl: (p: string) => p,
    getMeta: vi.fn(() => Promise.resolve({ root: '/tmp/x', owner: 'owner' })),
    listHermesRoles: vi.fn(() => Promise.resolve({ roles: [{ id: 'hermes', label: 'Hermes' }] })),
    hermesCall: vi.fn((method: string) =>
      method === 'session.create'
        ? Promise.resolve({ session_id: 's1', stored_session_id: 'k1' })
        : Promise.resolve({})),
    listTrash: vi.fn(() => Promise.resolve({ items: [] })),
    trashPath: vi.fn(() => Promise.resolve({ ok: true })),
    restoreFromTrash: vi.fn(() => Promise.resolve({ ok: true })),
    deleteFromTrash: vi.fn(() => Promise.resolve({ ok: true })),
  },
}));

describe('PrivyCloudTab file-system sharing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default implementations after any test overrode them.
    (api.listItems as ReturnType<typeof vi.fn>).mockResolvedValue(FIXTURE);
    (api.listTrash as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [] });
  });

  it('shows the sidebar places: Home, Recent, Trash and the category folders', async () => {
    render(<PrivyCloudTab />);
    await screen.findByTitle('Open Images'); // loaded
    for (const label of ['Home', 'Recent', 'Trash', 'Documents', 'Pictures', 'Videos', 'Slides', 'Markdown', 'Folders', 'Other']) {
      expect(screen.getAllByRole('button', { name: new RegExp(label) }).length).toBeGreaterThan(0);
    }
  });

  it('shows the category directories at the root (no nested files)', async () => {
    render(<PrivyCloudTab />);
    expect(await screen.findByTitle('Open Images')).toBeInTheDocument();
    expect(screen.getByTitle('Open Folders')).toBeInTheDocument();
    expect(screen.queryByText('a.png')).toBeNull();
    expect(screen.getByText('2 items')).toBeInTheDocument();
  });

  it('navigates into a folder when its tile is clicked', async () => {
    render(<PrivyCloudTab />);
    fireEvent.doubleClick(await screen.findByTitle('Open Images'));
    expect(screen.getByRole('button', { name: /a\.png/ })).toBeInTheDocument();
    expect(screen.getByTitle('Open sub')).toBeInTheDocument();
    expect(screen.queryByText('deep.txt')).toBeNull();
    expect(screen.getByText('2 items')).toBeInTheDocument();
  });

  it('navigates back to the root via the back button', async () => {
    render(<PrivyCloudTab />);
    fireEvent.doubleClick(await screen.findByTitle('Open Images'));
    fireEvent.click(screen.getByLabelText('back'));
    expect(screen.getByTitle('Open Images')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /a\.png/ })).toBeNull();
  });

  it('a sidebar category (Pictures) jumps into that folder', async () => {
    render(<PrivyCloudTab />);
    await screen.findByTitle('Open Images');
    fireEvent.click(screen.getAllByRole('button', { name: /Pictures/ })[0]); // sidebar item
    expect(screen.getByRole('button', { name: /a\.png/ })).toBeInTheDocument();
  });

  it('Recent shows only files, newest-modified first', async () => {
    (api.listItems as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'old.txt', path: 'Documents/old.txt', kind: 'document', size: 1, isDir: false, modifiedAt: '2026-08-18' },
      { name: 'new.png', path: 'Images/new.png', kind: 'image', size: 1, isDir: false, modifiedAt: '2026-08-20' },
      { name: 'x', path: 'Folders/x', kind: 'folder', size: 0, isDir: true, modifiedAt: '2026-08-20' },
    ]);
    render(<PrivyCloudTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Recent/ }));
    const titles = screen.getAllByTitle(/\.(txt|png)$/).map((el) => el.getAttribute('title'));
    expect(titles).toEqual(['new.png', 'old.txt']);
    expect(screen.queryByTitle(/^Open /)).toBeNull(); // no folder tiles in Recent
  });

  it('Trash lists trashed items with Restore and Delete-forever', async () => {
    (api.listTrash as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [{ path: 'Images/gone.jpg', name: 'gone.jpg', isDir: false, size: 1, modifiedAt: '' }],
    });
    render(<PrivyCloudTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Trash/ }));
    expect(await screen.findByText(/Images\/gone\.jpg/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(api.restoreFromTrash).toHaveBeenCalledWith('Images/gone.jpg');
  });

  it('renders chat oldest-first so the newest message is at the bottom', async () => {
    const { api } = await import('../api');
    (api.listChat as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: '2', ts: '2026-08-20T00:00:00Z', type: 'text', kind: 'text', name: 'b.md', text: 'newer msg', path: 'Markdown/b.md', sender: 'owner' },
      { id: '1', ts: '2026-08-19T00:00:00Z', type: 'text', kind: 'text', name: 'a.md', text: 'older msg', path: 'Markdown/a.md', sender: 'owner' },
    ]);
    render(<PrivyCloudTab />);
    await screen.findByText('newer msg');
    const order = screen.getAllByText(/older msg|newer msg/).map((el) => el.textContent);
    expect(order).toEqual(['older msg', 'newer msg']);
  });

  it('routes an @hermes message to the Hermes session via the relay', async () => {
    const { api } = await import('../api');
    render(<PrivyCloudTab />);
    const input = await screen.findByPlaceholderText(/Send message/);
    fireEvent.change(input, { target: { value: '@hermes list the files' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('@hermes list the files')).toBeInTheDocument();
    const calls = (api.hermesCall as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => c[0] === 'session.create')).toBe(true);
    const create = calls.find((c) => c[0] === 'session.create');
    expect(create?.[1]).toEqual({ cwd: '/tmp/x/Privy Cloud' });
    expect(calls.some((c) => c[0] === 'prompt.submit' && c[1]?.text === 'list the files')).toBe(true);
  });

  it('opens a file in the viewer and keeps the chat visible', async () => {
    render(<PrivyCloudTab />);
    fireEvent.doubleClick(await screen.findByTitle('Open Images'));
    fireEvent.doubleClick(screen.getByRole('button', { name: /a\.png/ }));
    expect(screen.getByText('← Back to sharing')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Send message, file, folder/)).toBeInTheDocument();
  });

  it('returns to the grid from the viewer, keeping the chat', async () => {
    render(<PrivyCloudTab />);
    fireEvent.doubleClick(await screen.findByTitle('Open Images'));
    fireEvent.doubleClick(screen.getByRole('button', { name: /a\.png/ }));
    fireEvent.click(screen.getByText('← Back to sharing'));
    expect(screen.getByRole('button', { name: /a\.png/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Send message, file, folder/)).toBeInTheDocument();
  });
});
