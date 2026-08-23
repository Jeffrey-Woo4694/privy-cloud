import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMenu } from '../components/ContextMenu';
import type { MenuItem } from '../contextMenu';

const items: MenuItem[] = [
  { id: 'open', label: 'Open', action: 'open' },
  { id: 'share', label: 'Share…', action: 'share', disabled: true },
];

describe('ContextMenu', () => {
  it('renders items, fires onSelect on click, then onClose', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={items} onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByText('Open'));
    expect(onSelect).toHaveBeenCalledWith('open');
    expect(onClose).toHaveBeenCalled();
  });

  it('disabled items do not fire onSelect', () => {
    const onSelect = vi.fn();
    render(<ContextMenu x={10} y={10} items={items} onSelect={onSelect} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Share…'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes on outside pointerdown and on Escape', () => {
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={items} onSelect={vi.fn()} onClose={onClose} />);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
