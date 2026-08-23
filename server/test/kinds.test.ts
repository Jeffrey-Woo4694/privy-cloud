import { describe, expect, it } from 'vitest';
import { detectKind } from '../src/kinds.js';

describe('kinds', () => {
  it('detectKind maps audio and archive extensions', () => {
    expect(detectKind('song.mp3', false)).toBe('audio');
    expect(detectKind('archive.zip', false)).toBe('archive');
    expect(detectKind('tape.tar', false)).toBe('archive');
    expect(detectKind('backup.tgz', false)).toBe('archive');
  });
});
