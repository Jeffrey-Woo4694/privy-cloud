import { useEffect, useRef } from 'react';

/**
 * Debounced autosave for the text editors: returns a `schedule()` to call from the
 * content-change handler; it fires `trigger` ~`delay`ms after the last call, so a
 * typing burst saves once it pauses. The latest `trigger` closure is always used
 * (no stale content) and any pending timer is cleared on unmount, so it never fires
 * after the editor goes away. Each save is versioned server-side (bounded history),
 * so autosaving never destroys prior content.
 */
export function useDebouncedAutosave(trigger: () => void, delay = 1200): () => void {
  const triggerRef = useRef(trigger);
  useEffect(() => { triggerRef.current = trigger; });
  const timer = useRef<number | null>(null);
  // Unmounting with a pending timer must not lose the edit — fire the save
  // (the editors' async onSave survives unmount; only setState would be dropped).
  useEffect(() => () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; triggerRef.current(); }
  }, []);
  return () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; triggerRef.current(); }, delay);
  };
}
