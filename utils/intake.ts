/**
 * External intake — files / text / URLs arriving from the OS.
 *
 * Three supported channels:
 *   1. File Handlers         — user chose "Open with AirGap" on a file.
 *                              Handled via window.launchQueue.setConsumer.
 *   2. Share Target (POST)   — user shared files from another app.
 *                              SW intercepts, writes to Cache Storage, redirects
 *                              to /?shared=<nonce>. We fetch the cache here.
 *   3. Share Target (GET)    — iOS PWA path for text/url-only shares.
 *                              Handled via ?text=&url=&title= query params.
 *
 * Exposes a subscription API so the React app can dispatch arriving items
 * without a tight timing coupling to mount order.
 */

export interface IntakeFileItem {
  kind: 'file';
  file: File;
}

export interface IntakeTextItem {
  kind: 'text';
  text: string;
  title?: string;
  url?: string;
}

export type IntakeItem = IntakeFileItem | IntakeTextItem;

type Listener = (item: IntakeItem) => void;
const listeners = new Set<Listener>();
const buffered: IntakeItem[] = [];

export function onIntake(fn: Listener): () => void {
  listeners.add(fn);
  // Flush any items buffered before the first subscriber mounted
  while (buffered.length) {
    const item = buffered.shift();
    if (item) fn(item);
  }
  return () => { listeners.delete(fn); };
}

function deliver(item: IntakeItem) {
  if (listeners.size === 0) {
    buffered.push(item);
    return;
  }
  for (const fn of listeners) fn(item);
}

/* ───── File Handlers — window.launchQueue ───── */

interface LaunchParams { files: FileSystemFileHandle[] }
interface LaunchQueueLike {
  setConsumer(cb: (params: LaunchParams) => void): void;
}

async function handleLaunchParams(params: LaunchParams): Promise<void> {
  if (!params?.files?.length) return;
  for (const handle of params.files) {
    try {
      const file = await handle.getFile();
      deliver({ kind: 'file', file });
    } catch (err) {
      console.warn('launchQueue: could not read file handle', err);
    }
  }
}

/* ───── Share Target ───── */

async function drainSharedNonce(nonce: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open('airgap-shares-v1');
    const keys = await cache.keys();
    const prefix = `/__share__/${nonce}/`;
    const matching = keys.filter((req) => new URL(req.url).pathname.startsWith(prefix));
    if (matching.length === 0) return;

    // Separate meta from files
    const metaReq = matching.find((r) => new URL(r.url).pathname.endsWith('/__meta__.json'));
    let meta: { title?: string; text?: string; url?: string } | null = null;
    if (metaReq) {
      try {
        const metaRes = await cache.match(metaReq);
        meta = metaRes ? await metaRes.json() : null;
      } catch {
        meta = null;
      }
    }

    const fileReqs = matching.filter((r) => !new URL(r.url).pathname.endsWith('/__meta__.json'));
    fileReqs.sort((a, b) => a.url.localeCompare(b.url)); // preserve share order via index prefix

    for (const req of fileReqs) {
      const res = await cache.match(req);
      if (!res) continue;
      const blob = await res.blob();
      const fileName = res.headers.get('X-File-Name')
        ?? decodeURIComponent(new URL(req.url).pathname.split('/').pop()!.replace(/^\d+-/, ''));
      const file = new File([blob], fileName, { type: blob.type });
      deliver({ kind: 'file', file });
    }

    if (fileReqs.length === 0 && meta && (meta.title || meta.text || meta.url)) {
      const pieces: string[] = [];
      if (meta.title) pieces.push(meta.title);
      if (meta.text) pieces.push(meta.text);
      if (meta.url) pieces.push(meta.url);
      deliver({ kind: 'text', text: pieces.join('\n\n'), title: meta.title, url: meta.url });
    }

    // Evict the bundle now that we've drained it
    for (const req of matching) await cache.delete(req);
  } catch (err) {
    console.warn('drainSharedNonce failed', err);
  } finally {
    // Clean the URL so a reload doesn't re-trigger intake
    clearSharedParams();
  }
}

function clearSharedParams(): void {
  try {
    const url = new URL(window.location.href);
    let dirty = false;
    for (const key of ['shared', 'text', 'url', 'title']) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        dirty = true;
      }
    }
    if (dirty) history.replaceState(null, '', url.toString());
  } catch {
    /* noop */
  }
}

function handleGetShareParams(params: URLSearchParams): void {
  const text = params.get('text');
  const url = params.get('url');
  const title = params.get('title');
  if (!text && !url && !title) return;

  const pieces: string[] = [];
  if (title) pieces.push(title);
  if (text) pieces.push(text);
  if (url) pieces.push(url);
  deliver({ kind: 'text', text: pieces.join('\n\n'), title: title ?? undefined, url: url ?? undefined });
  clearSharedParams();
}

/* ───── Boot ───── */

let booted = false;
export function initIntake(): void {
  if (booted || typeof window === 'undefined') return;
  booted = true;

  // 1. File Handlers — set consumer synchronously during first paint so we
  //    don't miss the initial launch event
  const lq = (window as unknown as { launchQueue?: LaunchQueueLike }).launchQueue;
  if (lq && typeof lq.setConsumer === 'function') {
    lq.setConsumer((params) => { void handleLaunchParams(params); });
  }

  // 2. Share Target — POST already handled by SW; look for the redirect nonce
  const params = new URLSearchParams(window.location.search);
  const sharedNonce = params.get('shared');
  if (sharedNonce && sharedNonce !== 'error') {
    void drainSharedNonce(sharedNonce);
  }

  // 3. Share Target — GET (iOS text/url path) and shortcuts
  handleGetShareParams(params);
}

/**
 * Pull the initial `mode` query param once (for the Sender/Receiver shortcuts
 * declared in manifest.shortcuts). Returns 'send' | 'receive' | null.
 */
export function initialShortcutMode(): 'send' | 'receive' | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  if (mode === 'send' || mode === 'receive') {
    // Strip it from the URL so refresh doesn't re-trigger
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('mode');
      history.replaceState(null, '', url.toString());
    } catch {/* noop */}
    return mode;
  }
  return null;
}
