import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync, existsSync, renameSync, mkdirSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { privyBase, resolveSafe } from './directory.js';
import { isOfficeEditable, officeFileType } from './fileModes.js';
import { writeBackup } from './backups.js';
import type { ServerEvent } from './api/routes.js';

const SESSION_TTL_MS = 30 * 60 * 1000;

export interface OfficeConfig {
  secret: string;
  engineUrl: string;
  getRoot(): string;
  emit(e: ServerEvent): void;
}

export interface ServerSession {
  rel: string;
  fileType: 'word' | 'cell' | 'slide';
  key: string;
  expiresAt: number;
  saved: boolean;
}

export interface OfficeSessionInfo {
  enabled: boolean;
  token?: string;
  key?: string;
  fileUrl?: string;
  callbackUrl?: string;
  engineUrl?: string;
  fileType?: 'word' | 'cell' | 'slide';
  title?: string;
  expiresAt?: string;
}

const isLoopbackOrPrivate = (host: string): boolean =>
  host === 'host.containers.internal' || host === 'localhost' ||
  /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === '::1' || host === '[::1]';

export class OfficeProvider {
  private readonly secret: string;
  private readonly engineUrl: string;
  private readonly getRoot: () => string;
  private readonly emit: (e: ServerEvent) => void;
  private readonly sessions = new Map<string, ServerSession>();
  private readonly locked = new Set<string>();

  constructor(cfg: OfficeConfig) {
    this.secret = cfg.secret;
    this.engineUrl = cfg.engineUrl;
    this.getRoot = cfg.getRoot;
    this.emit = cfg.emit;
  }

  isConfigured(): boolean {
    return this.engineUrl !== '';
  }

  /** A stable per-document cache key for the engine, keyed on content so an edit
   *  makes a new key (forcing the engine to reload fresh) without every open changing it. */
  private docKey(rel: string): string {
    const abs = resolveSafe(privyBase(this.getRoot()), rel);
    let mtimeMs = 0;
    if (abs && existsSync(abs)) mtimeMs = statSync(abs).mtimeMs;
    return createHash('sha1').update(`${rel}|${mtimeMs}`).digest('hex');
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('hex');
  }

  /** Sign only the expiry + a random nonce. The rel/fileType/key the original
   *  payload carried are never read (validateToken/streamFile/handleCallback all
   *  source those from the in-memory session map; only `valid` is consulted), and
   *  embedding them forced a `|`-delimited rel that parseToken later split —
   *  corrupting any filename containing `|` (reachable: sanitizeSegment allows it,
   *  and uploads use basename(fileName) unchecked). Expiry is still enforced via
   *  the session map's expiresAt, so the token need not carry it. */
  private mintToken(expiresAt: number): string {
    const nonce = randomBytes(8).toString('hex');
    const payload = `${expiresAt}|${nonce}`;
    return `${this.sign(payload)}.${Buffer.from(payload).toString('base64url')}`;
  }

  private parseToken(token: string): { valid: boolean } {
    const idx = token.indexOf('.');
    if (idx < 0) return { valid: false };
    const mac = token.slice(0, idx);
    const b64 = token.slice(idx + 1);
    let payload: string;
    try { payload = Buffer.from(b64, 'base64url').toString('utf8'); }
    catch { return { valid: false }; }
    return this.sign(payload) === mac ? { valid: true } : { valid: false };
  }

  /** Drop sessions past TTL and release their locks. Called on each session touch
   *  (createSession + validateToken) so an abandoned or already-saved session never
   *  leaves the map growing unboundedly or a file permanently locked: a rel whose
   *  session expired can be reopened. Bounds the map to the TTL window. */
  private sweepExpired(): void {
    const now = Date.now();
    for (const [token, s] of this.sessions) {
      if (now > s.expiresAt) {
        this.sessions.delete(token);
        this.locked.delete(s.rel);
      }
    }
  }

  createSession(rel: string): OfficeSessionInfo {
    if (!this.isConfigured()) return { enabled: false };
    this.sweepExpired(); // release any abandoned lock before the LOCKED check
    const name = basename(rel);
    if (!isOfficeEditable(name)) throw httpError('NOT_OFFICE', 'not an office document');
    if (this.locked.has(rel)) throw httpError('LOCKED', 'already being edited');
    const abs = resolveSafe(privyBase(this.getRoot()), rel);
    if (!abs || !existsSync(abs)) throw httpError('NOT_FOUND', 'not found');
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const fileType = officeFileType(ext);
    if (!fileType) throw httpError('NOT_OFFICE', 'not an office document');
    const key = this.docKey(rel);
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const token = this.mintToken(expiresAt);
    this.sessions.set(token, { rel, fileType, key, expiresAt, saved: false });
    this.locked.add(rel);
    const port = process.env.PRIVY_PORT ?? '5178';
    const origin = `http://host.containers.internal:${port}`;
    return {
      enabled: true, token, key, fileType,
      fileUrl: `${origin}/api/office/file?token=${encodeURIComponent(token)}`,
      callbackUrl: `${origin}/api/office/callback?token=${encodeURIComponent(token)}`,
      engineUrl: this.engineUrl,
      title: name,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  /** Validate a token without consuming it (the engine fetches the file, then POSTs a
   *  save with the same token). Returns the session or null when unknown/expired/saved. */
  validateToken(token: string): ServerSession | null {
    this.sweepExpired();
    const parsed = this.parseToken(token);
    if (!parsed.valid) return null;
    const s = this.sessions.get(token);
    if (!s) return null;
    if (Date.now() > s.expiresAt) { this.sessions.delete(token); this.locked.delete(s.rel); return null; }
    if (s.saved) return null; // a save already landed — don't allow a second write
    return s;
  }

  streamFile(token: string): { rel: string; mime: string } | null {
    const s = this.validateToken(token);
    if (!s) return null;
    const ext = s.rel.split('.').pop()?.toLowerCase() ?? '';
    const MIME: Record<string, string> = {
      doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      odt: 'application/vnd.oasis.opendocument.text', rtf: 'application/rtf',
      xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ods: 'application/vnd.oasis.opendocument.spreadsheet',
      ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      odp: 'application/vnd.oasis.opendocument.presentation',
    };
    return { rel: s.rel, mime: MIME[ext] ?? 'application/octet-stream' };
  }

  private async fetchSave(url: string): Promise<Buffer> {
    const host = new URL(url).hostname;
    const engineHost = this.engineUrl ? new URL(this.engineUrl).hostname : '';
    if (!isLoopbackOrPrivate(host) && host !== engineHost) {
      throw httpError('BAD_ORIGIN', 'save origin not allowed');
    }
    const res = await fetch(url);
    if (!res.ok) throw httpError('SAVE_FETCH_FAILED', 'could not fetch edited file');
    return Buffer.from(await res.arrayBuffer());
  }

  async handleCallback(token: string, body: Record<string, unknown>): Promise<{ error: number }> {
    const s = this.validateToken(token);
    if (!s) return { error: 1 };
    const status = Number(body?.status ?? 0);
    // Only status 2 (content saved) and 6 (force save) carry a downloadable url.
    if ((status === 2 || status === 6) && typeof body?.url === 'string' && body.url) {
      try {
        const data = await this.fetchSave(body.url as string);
        const abs = resolveSafe(privyBase(this.getRoot()), s.rel);
        if (!abs) return { error: 1 };
        // Backup the pre-overwrite bytes, then atomic-replace (temp + rename).
        if (existsSync(abs)) await writeBackup(this.getRoot(), s.rel, readFileSync(abs));
        mkdirSync(dirname(abs), { recursive: true });
        const tmp = join(dirname(abs), `.tmp-${randomBytes(6).toString('hex')}-${basename(s.rel)}`);
        await writeFile(tmp, data);
        renameSync(tmp, abs);
        const record = this.sessions.get(token);
        if (record) record.saved = true;
        this.locked.delete(s.rel);
        this.emit({ type: 'items:changed', path: s.rel, change: 'modified' });
      } catch {
        // A disallowed save origin or a fetch failure is a recoverable reject,
        // never a crash: report error 1 so the engine shows "Save failed".
        return { error: 1 };
      }
    }
    return { error: 0 };
  }
}

function httpError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
