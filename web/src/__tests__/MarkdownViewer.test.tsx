import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarkdownViewer } from '../components/MarkdownViewer';

describe('MarkdownViewer', () => {
  it('renders formatted markdown and exposes an Edit toggle', () => {
    const onEdit = vi.fn();
    render(<MarkdownViewer name="a.md" text="# Hello\n\n**bold**" onEdit={onEdit} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello');
    expect(screen.getByText('bold')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /edit as markdown/i }));
    expect(onEdit).toHaveBeenCalled();
  });
});
