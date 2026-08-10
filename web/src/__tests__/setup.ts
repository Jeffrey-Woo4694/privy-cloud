import '@testing-library/jest-dom/vitest';

globalThis.fetch ??= (() => Promise.reject(new Error('fetch not available in test'))) as typeof fetch;
// jsdom has no WebSocket; give PrivyCloudTab's live-update connect() a minimal fake so App tests can mount it.
class MockWebSocket {
  static readonly OPEN = 1; readonly OPEN = 1; readyState = 1;
  onopen: (() => void) | null = null; onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  close() { this.onclose?.(); }
}
globalThis.WebSocket ??= MockWebSocket as unknown as typeof WebSocket;
