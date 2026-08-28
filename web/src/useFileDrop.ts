import { useCallback, useState, type DragEvent } from 'react';
import { parseDrop, type DropData, type DropItem } from './dropPayload';

/**
 * HTML5 drag/drop handler for a file/folder drop target. Wires the standard
 * dragover/drop guards — both call preventDefault() so a dropped file never
 * navigates the whole page away — and parses the drop into upload items via
 * `parseDrop` (which reconstructs a dropped directory's structure). The target
 * supplies `onDrop(items)` to decide what to do (chat → send; grid → upload into
 * the current folder). Returns the handlers to attach plus a `dragging` flag for
 * a "Drop to upload" overlay.
 */
export function useFileDrop(onItems: (items: DropItem[]) => void, disabled = false) {
  const [dragging, setDragging] = useState(false);

  const onDragOver = useCallback((e: DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, [disabled]);

  const onDragLeave = useCallback((e: DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    setDragging(false);
  }, [disabled]);

  const onDrop = useCallback(async (e: DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    try {
      const items = await parseDrop(e.dataTransfer as unknown as DropData);
      if (items.length) onItems(items);
    } catch {
      // A malformed drop (e.g. from an external source) is simply ignored.
    }
  }, [disabled, onItems]);

  return { dragging, onDragOver, onDragLeave, onDrop };
}
