import { render, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ChatPanel } from '../components/ChatPanel';
import type { EntryLike } from '../dropPayload';

vi.mock('../api', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../api');
  return { ...actual, api: { ...actual.api, listHermesRoles: vi.fn().mockResolvedValue({ roles: [] }) } };
});

const props = () => ({
  entries: [], botThread: [],
  onSendText: vi.fn(), onSendHermes: vi.fn(), onNewSession: vi.fn(),
  onSendFiles: vi.fn(), onSendFolder: vi.fn(), onOpenFile: vi.fn(),
});

// Fakes matching the EntryLike shape parseDrop accepts.
function fileEntry(name: string): EntryLike {
  return { isFile: true, isDirectory: false, name, file(cb) { cb(new File(['x'], name)); } };
}
function dirEntry(name: string, children: EntryLike[]): EntryLike {
  let served = false;
  return {
    isFile: false, isDirectory: true, name,
    createReader() { return { readEntries(cb) { served ? cb([]) : (served = true, cb(children)); } }; },
  };
}
function item(entry: EntryLike) { return { kind: 'file', webkitGetAsEntry: () => entry, getAsFile: () => null }; }

describe('ChatPanel drop', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes a dropped loose file to onSendFiles', async () => {
    const p = props();
    const { container } = render(<ChatPanel {...p} />);
    fireEvent.drop(container.firstElementChild as HTMLElement, {
      dataTransfer: { items: [item(fileEntry('a.png'))], files: [] },
    });
    await waitFor(() => expect(p.onSendFiles).toHaveBeenCalled());
    expect(p.onSendFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'a.png' })]);
  });

  it('routes a dropped directory to onSendFolder', async () => {
    const p = props();
    const { container } = render(<ChatPanel {...p} />);
    fireEvent.drop(container.firstElementChild as HTMLElement, {
      dataTransfer: { items: [item(dirEntry('MyFolder', [fileEntry('b.txt')]))], files: [] },
    });
    await waitFor(() => expect(p.onSendFolder).toHaveBeenCalled());
  });
});
