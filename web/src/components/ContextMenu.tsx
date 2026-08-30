import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MenuAction, MenuItem } from '../contextMenu';
import { ShapeIcon } from './icons';

export function ContextMenu({ x, y, items, onSelect, onClose }: {
  x: number; y: number; items: MenuItem[]; onSelect(action: MenuAction): void; onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Measure once laid out, then clamp so the menu never escapes the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const py = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    setPos({ x: px, y: py });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = () => onClose();
    const onResize = () => onClose();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} role="menu" className="ctx-menu" style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 1000 }}>
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.separatorBefore && <div role="separator" className="ctx-menu-sep" />}
          <div role="menuitem" aria-disabled={item.disabled || undefined}
            className={`ctx-menu-item${item.danger ? ' danger' : ''}`}
            onClick={item.disabled ? undefined : () => { onSelect(item.action); onClose(); }}>
            {item.icon && <span className="ctx-menu-icon"><ShapeIcon name={item.icon} size={14} /></span>}
            <span className="ctx-menu-label">{item.label}</span>
          </div>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
