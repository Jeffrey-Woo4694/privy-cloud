import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '../csv';

describe('parseCsv', () => {
  it('parses unquoted rows', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('does not split on commas inside quotes', () => {
    expect(parseCsv('a,"b,c"\nd,e')).toEqual([['a', 'b,c'], ['d', 'e']]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('"he said ""hi""",x')).toEqual([['he said "hi"', 'x']]);
  });

  it('supports newlines inside quotes', () => {
    expect(parseCsv('a,"line1\nline2",c')).toEqual([['a', 'line1\nline2', 'c']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('keeps empty quoted fields', () => {
    expect(parseCsv('a,"",b')).toEqual([['a', '', 'b']]);
  });
});

describe('toCsv', () => {
  it('joins cells with commas and rows with newlines', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\nc,d');
  });

  it('quotes and escapes fields containing commas or quotes', () => {
    expect(toCsv([['a,b']])).toBe('"a,b"');
    expect(toCsv([['say "hi"']])).toBe('"say ""hi"""');
  });

  it('is a lossless roundtrip through parseCsv', () => {
    const rows = [['a', 'b,c'], ['say "hi"', 'x\ny'], ['', 'z']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
