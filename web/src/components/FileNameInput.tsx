import { useEffect, useRef, useState } from 'react';

/** The editable file name in an editor's head row — always a field, always showing
 *  just the name (never the parent directory). Enter or blur commits the rename
 *  (like the grid's tile rename); Escape reverts. The rename itself goes through
 *  the parent (which saves any pending edit first, then calls the API) — on
 *  failure the field snaps back to the on-disk name. Without `onRename` the field
 *  is read-only (a viewer opened without rename wiring still shows the name). */
export function FileNameInput({ name, onRename }: { name: string; onRename?: (newName: string) => Promise<void> }) {
  const [value, setValue] = useState(name);
  const done = useRef(false); // blur re-fires after an Enter commit — guard the double-fire
  useEffect(() => { setValue(name); }, [name]);

  const finish = async (v: string) => {
    if (done.current) return;
    done.current = true;
    const t = v.trim();
    if (onRename && t && t !== name) {
      try { await onRename(t); }
      catch { setValue(name); } // disk kept the old name — snap back
    } else {
      setValue(name);
    }
    done.current = false; // a further edit + blur is a fresh commit, not a double-fire
  };

  return (
    <input
      className="editor-name" value={value} title={name} aria-label="File name" spellCheck={false}
      readOnly={!onRename}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => {
        done.current = false;
        // Select just the base (not the extension), so typing replaces the name and
        // the type stays — same convention as the grid's rename input.
        const dot = name.lastIndexOf('.');
        if (dot > 0) e.target.setSelectionRange(0, dot); else e.target.select();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); void finish(e.currentTarget.value); }
        else if (e.key === 'Escape') { e.preventDefault(); done.current = true; setValue(name); e.currentTarget.blur(); done.current = false; }
      }}
      onBlur={(e) => { void finish(e.currentTarget.value); }}
    />
  );
}
