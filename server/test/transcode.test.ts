import { describe, expect, it, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { initRootStructure, proxyPathFor, pendingPathFor, listItems } from '../src/directory.js';
import { needsProxy, probeCodec, ensureProxy, cleanupOrphanedProxies } from '../src/transcode.js';

function ffmpegAvailable(): boolean {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
const FF = ffmpegAvailable();

describe('needsProxy', () => {
  it('flags HEVC and other non-web codecs', () => {
    expect(needsProxy('hevc')).toBe(true);
    expect(needsProxy('h265')).toBe(true);
    expect(needsProxy('prores')).toBe(true);
  });

  it('accepts browser-playable video codecs', () => {
    expect(needsProxy('h264')).toBe(false);
    expect(needsProxy('vp9')).toBe(false);
    expect(needsProxy('av1')).toBe(false);
  });

  it('accepts browser-playable image codecs', () => {
    expect(needsProxy('mjpeg')).toBe(false);
    expect(needsProxy('png')).toBe(false);
    expect(needsProxy('gif')).toBe(false);
    expect(needsProxy('webp')).toBe(false);
  });

  it('treats an unknown codec as no-proxy (leave the original alone)', () => {
    expect(needsProxy(null)).toBe(false);
    expect(needsProxy(undefined)).toBe(false);
    expect(needsProxy('')).toBe(false);
  });
});

describe('proxy paths', () => {
  it('mirrors the original path (reversible) with a kind-specific suffix', () => {
    const root = '/tmp/privy-any';
    expect(proxyPathFor(root, 'Videos/foo.mov', 'video')).toMatch(/\.privy\/proxies\/Videos\/foo\.mov\.mp4$/);
    expect(proxyPathFor(root, 'Images/foo.heic', 'image')).toMatch(/\.privy\/proxies\/Images\/foo\.heic\.jpg$/);
    expect(pendingPathFor(root, 'Images/foo.heic', 'image')).toBe(`${proxyPathFor(root, 'Images/foo.heic', 'image')}.pending`);
  });
});

describe('cleanupOrphanedProxies', () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('removes video and image proxies whose original is gone, keeps those with a live original', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-tc-'));
    await initRootStructure(root);
    mkdirSync(join(root, 'Privy Cloud', 'Videos'), { recursive: true });

    // orphaned video proxy + pending marker (no original on disk)
    mkdirSync(dirname(proxyPathFor(root, 'Videos/gone.mov', 'video')), { recursive: true });
    writeFileSync(proxyPathFor(root, 'Videos/gone.mov', 'video'), 'x');
    writeFileSync(pendingPathFor(root, 'Videos/gone.mov', 'video'), '');

    // orphaned image proxy (no original)
    mkdirSync(dirname(proxyPathFor(root, 'Images/gone.heic', 'image')), { recursive: true });
    writeFileSync(proxyPathFor(root, 'Images/gone.heic', 'image'), 'y');

    // live original, so its proxy must survive
    writeFileSync(join(root, 'Privy Cloud', 'Videos', 'live.mov'), 'z');
    mkdirSync(dirname(proxyPathFor(root, 'Videos/live.mov', 'video')), { recursive: true });
    writeFileSync(proxyPathFor(root, 'Videos/live.mov', 'video'), 'w');

    await cleanupOrphanedProxies(root);

    expect(existsSync(proxyPathFor(root, 'Videos/gone.mov', 'video'))).toBe(false);
    expect(existsSync(pendingPathFor(root, 'Videos/gone.mov', 'video'))).toBe(false);
    expect(existsSync(proxyPathFor(root, 'Images/gone.heic', 'image'))).toBe(false);
    expect(existsSync(proxyPathFor(root, 'Videos/live.mov', 'video'))).toBe(true);
  });
});

describe.skipIf(!FF)('ensureProxy', () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function makeHevc(rel: string): void {
    const abs = join(root, 'Privy Cloud', rel);
    mkdirSync(dirname(abs), { recursive: true });
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=128x128:rate=30',
      '-c:v', 'libx265', '-pix_fmt', 'yuv420p', abs,
    ], { stdio: 'ignore' });
  }

  it('creates an H.264 video proxy and leaves the HEVC original untouched', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-tc-'));
    await initRootStructure(root);
    const rel = 'Videos/test.mov';
    makeHevc(rel);
    const origAbs = join(root, 'Privy Cloud', rel);
    const origBytes = readFileSync(origAbs);
    expect(await probeCodec(origAbs)).toBe('hevc');

    const emitted: string[] = [];
    await ensureProxy(root, rel, 'video', (e) => emitted.push(e.path));

    const proxy = proxyPathFor(root, rel, 'video');
    expect(existsSync(proxy)).toBe(true);
    expect(await probeCodec(proxy)).toBe('h264');
    expect(readFileSync(origAbs)).toEqual(origBytes); // original byte-identical
    expect(emitted).toContain(rel);

    const item = (await listItems(root)).find((i) => i.path === rel)!;
    expect(item.hasProxy).toBe(true);
    expect(item.proxyPending).toBe(false);
  });

  it('creates a JPEG image proxy for HEIC (hevc) content', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-tc-'));
    await initRootStructure(root);
    const rel = 'Images/test.heic';
    const abs = join(root, 'Privy Cloud', rel);
    mkdirSync(dirname(abs), { recursive: true });
    // No HEIC muxer is available, so write 1-frame HEVC in mp4 and name it .heic; ffprobe/ffmpeg
    // sniff the content as `hevc` — exactly what a real HEIC image reports.
    const fixture = join(root, 'fixture.mp4');
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc=duration=0.1:size=64x64:rate=10',
      '-frames:v', '1', '-c:v', 'libx265', '-pix_fmt', 'yuv420p', fixture,
    ], { stdio: 'ignore' });
    copyFileSync(fixture, abs);
    expect(await probeCodec(abs)).toBe('hevc');

    await ensureProxy(root, rel, 'image', () => {});

    const proxy = proxyPathFor(root, rel, 'image');
    expect(existsSync(proxy)).toBe(true);
    expect(await probeCodec(proxy)).toBe('mjpeg');

    const item = (await listItems(root)).find((i) => i.path === rel)!;
    expect(item.hasProxy).toBe(true);
  });

  it('does nothing for an already-playable H.264 video', async () => {
    root = mkdtempSync(join(tmpdir(), 'privy-tc-'));
    await initRootStructure(root);
    const rel = 'Videos/ok.mp4';
    const abs = join(root, 'Privy Cloud', rel);
    mkdirSync(dirname(abs), { recursive: true });
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=128x128:rate=30',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', abs,
    ], { stdio: 'ignore' });

    await ensureProxy(root, rel, 'video', () => {});
    expect(existsSync(proxyPathFor(root, rel, 'video'))).toBe(false); // no proxy needed
  });
});
