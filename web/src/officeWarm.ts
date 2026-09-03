// Warms the OnlyOffice engine at app launch so the first document open isn't the
// moment we pay for it.
//
// Two costs are paid on every cold open otherwise: the TLS/connection handshake to
// the engine origin, and the editor loader (api.js), which the engine serves
// `no-store` — so the browser refetches it each time even though the versioned
// bundles behind it are cached `immutable`. A preconnect covers the first; loading
// the loader once covers the second, since it defines a `window.DocsAPI` global the
// editor reuses from then on.
//
// This is best-effort: a missing, disabled, or unreachable engine must never keep
// the app from starting, so every failure here is swallowed.
import { api } from './api';

let warmed = false;

/** Test seam: forget that warming already happened. */
export function __resetOfficeWarmForTests(): void {
  warmed = false;
}

export async function warmOfficeEngine(): Promise<void> {
  if (warmed) return;
  warmed = true;
  try {
    const { enabled, engineUrl } = await api.officeEngine();
    if (!enabled || !engineUrl) return;

    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = engineUrl;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);

    // Already loaded (a document was opened before this resolved) — nothing to fetch.
    if (window.DocsAPI) return;
    const script = document.createElement('script');
    script.src = `${engineUrl}/web-apps/apps/api/documents/api.js`;
    script.async = true;
    document.head.appendChild(script);
  } catch {
    // Engine unreachable or not configured: opens still work, just cold.
  }
}
