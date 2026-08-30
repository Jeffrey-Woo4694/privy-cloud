import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreateDialog } from '../components/CreateDialog';

describe('CreateDialog', () => {
  it('renders the title and labeled input', () => {
    render(<CreateDialog kind="folder" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('New Folder')).toBeTruthy();
    expect(screen.getByPlaceholderText('Folder Name')).toBeTruthy();
    render(<CreateDialog kind="file" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('New File')).toBeTruthy();
  });

  it('submits the trimmed name on Create', () => {
    const onConfirm = vi.fn();
    render(<CreateDialog kind="file" onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('File Name'), { target: { value: '  notes.txt  ' } });
    fireEvent.click(screen.getByText('Create'));
    expect(onConfirm).toHaveBeenCalledWith('notes.txt');
  });

  it('submits on Enter', () => {
    const onConfirm = vi.fn();
    render(<CreateDialog kind="folder" onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Folder Name'), { target: { value: 'a' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Folder Name'), { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledWith('a');
  });

  it('cancels on Escape and clicks the backdrop', () => {
    const onCancel = vi.fn();
    render(<CreateDialog kind="folder" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByPlaceholderText('Folder Name'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables Create when the name is empty', () => {
    render(<CreateDialog kind="folder" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect((screen.getByText('Create').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
