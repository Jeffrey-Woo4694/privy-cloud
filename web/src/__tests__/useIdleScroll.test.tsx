import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { useIdleScroll } from '../useIdleScroll';

// A scroll container holding content, so a pointer event inside it resolves to a
// scrollable ancestor.
function Harness() {
  useIdleScroll();
  return (
    <div id="scroll" style={{ overflowY: 'auto' }}>
      <span id="content">content</span>
    </div>
  );
}

describe('useIdleScroll', () => {
  it('shows the scrollbar while the pointer is over a scroll region, then hides it after idle', () => {
    vi.useFakeTimers();
    const { container } = render(<Harness />);
    const scroll = container.querySelector('#scroll')!;
    const content = container.querySelector('#content')!;

    expect(scroll.classList.contains('scroll-active')).toBe(false); // hidden on load

    fireEvent.mouseMove(content); // pointer enters the region → thumb shows
    expect(scroll.classList.contains('scroll-active')).toBe(true);

    act(() => { vi.advanceTimersByTime(1500); }); // mouse goes quiet → thumb hides
    expect(scroll.classList.contains('scroll-active')).toBe(false);

    vi.useRealTimers();
  });

  it('keeps the scrollbar visible while the region is being wheel-scrolled, regardless of pointer motion', () => {
    vi.useFakeTimers();
    const { container } = render(<Harness />);
    const scroll = container.querySelector('#scroll')!;
    const content = container.querySelector('#content')!;

    fireEvent.wheel(content); // wheel alone (no mousemove) still arms it
    expect(scroll.classList.contains('scroll-active')).toBe(true);

    // Idle resets even if the pointer never leaves; a later wheel re-arms it.
    act(() => { vi.advanceTimersByTime(1500); });
    expect(scroll.classList.contains('scroll-active')).toBe(false);
    fireEvent.wheel(content);
    expect(scroll.classList.contains('scroll-active')).toBe(true);

    vi.useRealTimers();
  });
});
