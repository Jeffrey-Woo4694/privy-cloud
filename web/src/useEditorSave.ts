import { useEffect, useRef, useState } from 'react';
import { useDebouncedAutosave } from './useDebouncedAutosave';

/** Save plumbing shared by the text/markdown editors: a debounced autosave, a
 *  manual `save()` (button + Ctrl/Cmd+S), and a small `status` string that the
 *  head row paints as ghost text next to the Save button ("Saving…" / "Saved" /
 *  "Save failed"). The button itself never changes size or label — the status
 *  slot is what reacts.
 *
 *  Saves are deduped: writing a buffer identical to the last saved text reports
 *  success without hitting the server, so repeated clicks, an unmount flush after
 *  the autosave already landed, or Ctrl+S out of habit never churn the bounded
 *  server-side version history. */
export function useEditorSave(content: string, onSave: (c: string) => Promise<void>) {
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const lastSaved = useRef(content);
  const dirty = content !== lastSaved.current;
  const flashTimer = useRef<number | null>(null);

  // A short-lived ghost message; the slot keeps its width so nothing shifts.
  const flash = (s: string) => {
    setStatus(s);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => { flashTimer.current = null; setStatus(''); }, 1500);
  };
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);

  const save = async () => {
    if (saving) return; // ignore repeats (button is disabled while saving; shortcut too)
    if (!dirty) { flash('Saved'); return; } // nothing pending — confirm, don't rewrite
    setSaving(true);
    setError('');
    try {
      await onSave(content);
      lastSaved.current = content;
      flash('Saved');
    } catch (e) {
      setError((e as Error).message || 'Save failed');
      flash('Save failed');
    } finally {
      setSaving(false);
    }
  };

  // Adopt externally (re)seeded content as saved — the async first load and the
  // post-rename refetch set the buffer without the user having typed.
  const markSaved = (v: string) => { lastSaved.current = v; };

  // Keep the latest save in a ref so the Ctrl+S listener below always calls the
  // current closure (with the freshest content), without re-attaching per render.
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });

  // Ctrl+S / Cmd+S saves the file and prevents the browser's default "Save Page".
  // Attached at the window so it works wherever focus is inside the editor, and
  // removed on unmount so it never leaks beyond this view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Autosave ~1.2s after the last keystroke. Each save is backed up server-side
  // (bounded version history), so autosaving never destroys the prior content; the
  // dedupe above stops it from ever saving the same text twice. A pending edit also
  // flushes if the editor unmounts mid-debounce (Esc closes).
  const scheduleSave = useDebouncedAutosave(save);

  return { save, scheduleSave, markSaved, saving, status, error, dirty };
}
