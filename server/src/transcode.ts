import { mkdirSync, rmSync, existsSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, relative } from 'node:path';
import type { FileItem } from '@privy/shared';
import { resolveSafe, privyBase, proxyDir, proxyPathFor, pendingPathFor, listItems, type ProxyKind } from './directory.js';

const execFileP = promisify(execFile);

export type VideoEmit = (event: { type: 'items:changed'; path: string; change: 'modified' }) => void;

/** Codecs browsers can't render natively: HEVC video, HEIC images (both `hevc`), and a few
 *  pro formats. Everything else (h264, vp9, av1, mjpeg, png, gif, webp, …) plays directly. */
const NEEDS_PROXY = new Set(['hevc', 'h265', 'prores', 'dnxhd', 'mpeg2video']);

export function needsProxy(codec: string | null | undefined): boolean {
  if (!codec) return false; // unknown → leave the original alone rather than risk a bad transcode
  return NEEDS_PROXY.has(codec.toLowerCase());
}

/** First video stream's codec name, or null if not media / ffprobe unavailable. */
export async function probeCodec(abs: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      abs,
    ]);
    return stdout.trim().split('\n')[0].trim() || null;
  } catch {
    return null;
  }
}

function transcodeArgs(kind: ProxyKind): string[] {
  if (kind === 'video') {
    // Preserves resolution + frame rate; auto-applies rotation. 10-bit HDR is downconverted
    // to 8-bit SDR (yuv420p) for browser compatibility. libx264 output plays everywhere.
    return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'];
  }
  // HEIC → JPEG at full resolution, high quality.
  return ['-c:v', 'mjpeg', '-q:v', '2', '-pix_fmt', 'yuvj420p'];
}

async function transcode(input: string, output: string, kind: ProxyKind): Promise<void> {
  await execFileP('ffmpeg', ['-y', '-i', input, ...transcodeArgs(kind), output]);
}

/**
 * Ensure a browser-playable proxy exists for a media file (rel is relative to `Privy Cloud/`).
 * Idempotent: no-op when a proxy already exists or the codec is already playable.
 * The original file is never modified. Emits `items:changed` when a proxy is created so
 * connected clients re-fetch and switch to the playable URL.
 */
export async function ensureProxy(root: string, rel: string, kind: ProxyKind, emit: VideoEmit): Promise<void> {
  const abs = resolveSafe(privyBase(root), rel);
  if (!abs) return;
  const proxy = proxyPathFor(root, rel, kind);
  const pending = pendingPathFor(root, rel, kind);

  if (existsSync(proxy)) { rmSync(pending, { force: true }); return; }

  const codec = await probeCodec(abs);
  if (!needsProxy(codec)) { rmSync(pending, { force: true }); return; }

  mkdirSync(dirname(proxy), { recursive: true });
  writeFileSync(pending, '');
  try {
    await transcode(abs, proxy, kind);
    rmSync(pending, { force: true });
    emit({ type: 'items:changed', path: rel, change: 'modified' });
  } catch {
    // Transcode failed (e.g. exotic codec/container): clear the marker and leave the
    // original untouched. The file remains downloadable, just not inline-previewable.
    rmSync(pending, { force: true });
  }
}

/**
 * Backfill proxies for every existing video/image that needs one (HEVC/HEIC files already in
 * the vault, and crash recovery of stale `.pending` markers). Runs at startup, capped at
 * `concurrency` ffmpeg jobs.
 */
export async function backfillProxies(root: string, emit: VideoEmit, concurrency = 2): Promise<void> {
  const items: FileItem[] = await listItems(root).catch(() => []);
  const queue = items.filter((i) => (i.kind === 'video' || i.kind === 'image') && !i.isDir);
  const worker = async (): Promise<void> => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      await ensureProxy(root, item.path, item.kind as ProxyKind, emit).catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
}

/**
 * Remove proxy files (and pending markers) whose original media file no longer exists.
 * The proxy path mirrors the original (`<rel>.<ext>`), so the source rel is recoverable.
 * Runs at startup and periodically; best-effort (never throws).
 */
export async function cleanupOrphanedProxies(root: string): Promise<void> {
  const dir = proxyDir(root);
  if (!existsSync(dir)) return;
  const SUFFIXES = ['.mp4', '.jpg'];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) { walk(abs); continue; }
      const rel = relative(dir, abs);
      let orig: string | null = null;
      for (const s of SUFFIXES) {
        if (rel.endsWith(`${s}.pending`)) { orig = rel.slice(0, -(`${s}.pending`.length)); break; }
        if (rel.endsWith(s)) { orig = rel.slice(0, -s.length); break; }
      }
      if (!orig) continue;
      const origAbs = resolveSafe(privyBase(root), orig);
      if (!origAbs || !existsSync(origAbs)) rmSync(abs, { force: true });
    }
  };
  try { walk(dir); } catch { /* best-effort cleanup */ }
}
