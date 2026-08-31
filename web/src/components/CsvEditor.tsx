import { useEffect, useRef, useState } from 'react';
import { parseCsv, toCsv } from '../csv';
import { useDebouncedAutosave } from '../useDebouncedAutosave';

/** A spreadsheet-style editor for CSV: editable cell grid with add/remove rows and
 *  columns, saving back to valid (RFC 4180) CSV. This is the byte-faithful fallback
 *  for the OnlyOffice editor — it writes the raw text back exactly, so quoting and
 *  line-endings are preserved (OnlyOffice re-serializes on save). */
export function CsvEditor({ initialText, name, onSave, onCancel }: {
  initialText: string;
  name: string;
  onSave: (content: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<string[][]>(() => {
    const r = parseCsv(initialText);
    return r.length ? r : [['']];
  });
  const [saving, setSaving] = useState(false);
  const cols = Math.max(1, ...rows.map((r) => r.length));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try { await onSave(toCsv(rows)); } finally { setSaving(false); }
  };
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });
  // Ctrl/Cmd+S to save, mirroring the text editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void saveRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Autosave ~1.2s after the last edit (cell or row/column structure change).
  const schedule = useDebouncedAutosave(() => void saveRef.current());
  const updateCell = (r: number, c: number, v: string) => {
    setRows((rs) => rs.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)));
    schedule();
  };
  const addRow = () => { setRows((rs) => [...rs, Array(cols).fill('')]); schedule(); };
  const deleteRow = (r: number) => { setRows((rs) => rs.filter((_, i) => i !== r)); schedule(); };
  const addCol = () => { setRows((rs) => rs.map((row) => [...row, ''])); schedule(); };
  const deleteCol = (c: number) => { setRows((rs) => rs.map((row) => row.filter((_, j) => j !== c))); schedule(); };

  return (
    <div className="viewer-body" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontWeight: 600 }}>{name}</span>
        <button className="btn primary" onClick={save} disabled={saving} title="Ctrl+S">{saving ? 'Saving…' : 'Save'}</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={addRow}>+ Row</button>
        <button className="btn" onClick={addCol}>+ Column</button>
      </div>
      <div className="structured scroll" style={{ marginTop: 8 }}>
        <table className="structured-table">
          <thead>
            <tr>
              <th className="csv-corner" />
              {Array.from({ length: cols }).map((_, c) => (
                <th key={c}><button className="btn" onClick={() => deleteCol(c)} title={`Delete column ${c + 1}`}>×</button></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                <td className="csv-corner"><button className="btn" onClick={() => deleteRow(r)} title={`Delete row ${r + 1}`}>×</button></td>
                {Array.from({ length: cols }).map((_, c) => (
                  <td key={`${r}:${c}`}><input className="csv-cell" value={row[c] ?? ''} onChange={(e) => updateCell(r, c, e.target.value)} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
