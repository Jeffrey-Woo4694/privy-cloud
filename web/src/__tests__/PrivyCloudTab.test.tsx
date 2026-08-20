import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PrivyCloudTab } from '../pages/PrivyCloudTab';

vi.mock('../ws', () => ({ connect: vi.fn(() => () => {}) }));

const FIXTURE = [
  { name: 'Images', path: 'Images', kind: 'folder', size: 0, isDir: true, modifiedAt: '' },
  { name: 'Folders', path: 'Folders', kind: 'folder', size: 0, isDir: true, modifiedAt: '' },
  { name: 'a.png', path: 'Images/a.png', kind: 'image', size: 1, isDir: false, modifiedAt: '' },
  { name: 'sub', path: 'Images/sub', kind: 'folder', size: 0, isDir: true, modifiedAt: '' },
  { name: 'deep.txt', path: 'Images/sub/deep.txt', kind: 'document', size: 1, isDir: false, modifiedAt: '' },
];

// The factory references FIXTURE lazily (at call time, after module init), so the
// closure-over-const pattern is safe under vi.mock hoisting.
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
  },
}));

function kindChip(label: string): HTMLElement {
  return screen.getAllByRole('button', { name: label }).find((b) => b.className.includes('kind-chip'))!;
}

describe('PrivyCloudTab directory browsing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the category directories at the root (no nested files)', async () => {
    render(<PrivyCloudTab />);
    expect(await screen.findByTitle('Open Images')).toBeInTheDocument();
    expect(screen.getByTitle('Open Folders')).toBeInTheDocument();
    // Nested items are not shown at the root.
    expect(screen.queryByText('a.png')).toBeNull();
    expect(screen.queryByTitle('Open Images/a.png')).toBeNull();
  });

  it('navigates into a folder when its tile is clicked', async () => {
    render(<PrivyCloudTab />);
    fireEvent.click(await screen.findByTitle('Open Images'));
    // Direct children are visible; deeper-nested ones are not.
    expect(screen.getByRole('button', { name: /a\.png/ })).toBeInTheDocument();
    expect(screen.getByTitle('Open sub')).toBeInTheDocument();
    expect(screen.queryByText('deep.txt')).toBeNull();
    // Breadcrumb shows the current directory.
    expect(screen.getByLabelText('current directory')).toHaveTextContent('Images');
    expect(screen.getByText('← Back')).toBeInTheDocument();
  });

  it('navigates back to the root via Back', async () => {
    render(<PrivyCloudTab />);
    fireEvent.click(await screen.findByTitle('Open Images'));
    fireEvent.click(screen.getByText('← Back'));
    expect(screen.getByTitle('Open Images')).toBeInTheDocument();
    expect(screen.queryByText('← Back')).toBeNull();
    expect(screen.queryByRole('button', { name: /a\.png/ })).toBeNull();
  });

  it('a kind chip at the root jumps into that category directory', async () => {
    render(<PrivyCloudTab />);
    fireEvent.click(await screen.findByTitle('Open Images')); // wait for load
    fireEvent.click(screen.getByText('← Back')); // back to root
    fireEvent.click(kindChip('Images'));
    expect(screen.getByText('← Back')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /a\.png/ })).toBeInTheDocument();
  });

  it('opens a file in the viewer', async () => {
    render(<PrivyCloudTab />);
    fireEvent.click(await screen.findByTitle('Open Images'));
    fireEvent.click(screen.getByRole('button', { name: /a\.png/ }));
    expect(screen.getByText('← Back to sharing')).toBeInTheDocument();
  });

  it('keeps the chat panel visible while a file is open', async () => {
    render(<PrivyCloudTab />);
    fireEvent.click(await screen.findByTitle('Open Images'));
    fireEvent.click(screen.getByRole('button', { name: /a\.png/ }));
    // The viewer is shown inside the sharing panel, but the right chat stays put.
    expect(screen.getByText('← Back to sharing')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Send message, file, folder/)).toBeInTheDocument();
  });

  it('returns to the grid from the viewer, keeping the chat', async () => {
    render(<PrivyCloudTab />);
    fireEvent.click(await screen.findByTitle('Open Images'));
    fireEvent.click(screen.getByRole('button', { name: /a\.png/ }));
    fireEvent.click(screen.getByText('← Back to sharing'));
    // Back on the grid in the current directory (Images), with the chat intact.
    expect(screen.getByRole('button', { name: /a\.png/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Send message, file, folder/)).toBeInTheDocument();
  });
});
