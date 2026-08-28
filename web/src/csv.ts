// RFC 4180 CSV parse + serialize. OnlyOffice re-serializes CSV on save (its
// quoting/line-endings can change), so the sharing grid also offers a byte-faithful
// grid editor built on these helpers — the grid parses real CSV and writes it back
// exactly, without the engine touching it.

/** Parse CSV text into rows of cells. Handles quoted fields, `""` escapes,
 *  newlines inside quotes, and CRLF endings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < len) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ',') { endField(); i += 1; continue; }
    if (c === '\r') { i += 1; continue; } // swallow CR of a CRLF pair
    if (c === '\n') { endRow(); i += 1; continue; }
    field += c; i += 1;
  }
  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

/** Serialize rows back to CSV, quoting any field with a comma, quote, CR or LF. */
export function toCsv(rows: string[][]): string {
  return rows
    .map((row) => row
      .map((cell) => {
        const s = cell ?? '';
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(','))
    .join('\n');
}
