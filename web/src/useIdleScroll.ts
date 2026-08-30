import { useEffect } from 'react';

/// Simplified, self-hiding scrollbars. While the pointer rests over a scrollable
/// region (or the region is being wheel-scrolled) the container carries
/// `.scroll-active`, which theme.css uses to draw its thumb. Once the pointer goes
/// quiet for a moment the class drops and the thumb fades out — so a scrollbar
/// never lingers on screen when the mouse is idle.
/// The hook is global: it finds the scroll container under the pointer on each
/// move, so no component needs to opt in.
const IDLE_MS = 1500;

function scrollableAncestor(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  let el: Element | null = target;
  while (el) {
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowY) || /(auto|scroll)/.test(s.overflow)) return el as HTMLElement;
    el = el.parentElement;
  }
  return null;
}

export function useIdleScroll() {
  useEffect(() => {
    // A Map so the unmount cleanup can clear every timer; entries are transient
    // (deleted when each element's timer fires) so they don't leak.
    const timers = new Map<Element, ReturnType<typeof setTimeout>>();

    const arm = (target: EventTarget | null) => {
      const el = scrollableAncestor(target);
      if (!el) return;
      el.classList.add('scroll-active');
      const existing = timers.get(el);
      if (existing) clearTimeout(existing);
      timers.set(el, setTimeout(() => { el.classList.remove('scroll-active'); timers.delete(el); }, IDLE_MS));
    };

    const onMove = (e: MouseEvent) => arm(e.target);
    const onWheel = (e: WheelEvent) => arm(e.target);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('wheel', onWheel);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('wheel', onWheel);
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);
}
