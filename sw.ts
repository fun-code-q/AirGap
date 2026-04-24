/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

// injectManifest injects __WB_MANIFEST at build time with the precache list
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ revision: string | null; url: string }>;
};

/* ─────────────── Precache ─────────────── */

precacheAndRoute(self.__WB_MANIFEST);

// Navigation fallback — any GET navigation that isn't precached should resolve
// to the app shell so deep links / shortcuts work offline.
const navHandler = createHandlerBoundToURL('index.html');
const navRoute = new NavigationRoute(navHandler, {
  // Don't intercept POSTs (share target) or fetches that look like assets
  denylist: [/^\/api\//, /\.[a-z0-9]+$/i],
});
registerRoute(navRoute);

/* ─────────────── Share Target POST handler ─────────────── */

// The manifest declares:
//   share_target: { action: '/', method: 'POST', enctype: 'multipart/form-data' }
// When the user shares files from another app, the OS sends multipart/form-data
// to this origin. Without a SW, that would 404 the static host. We parse it
// here, stash files in Cache Storage keyed by a fresh UUID, and redirect to
// the app with ?shared=<key>. The app reads the cache and dispatches to Sender.
const SHARE_CACHE = 'airgap-shares-v1';

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only intercept POSTs to our origin root (matches share_target.action: '/AirGap/')
  if (request.method !== 'POST' || url.pathname !== '/AirGap/') return;

  event.respondWith(handleShareTarget(event));
});

async function handleShareTarget(event: FetchEvent): Promise<Response> {
  try {
    const formData = await event.request.formData();
    const files: File[] = [];
    for (const entry of formData.getAll('files')) {
      if (entry instanceof File && entry.size > 0) files.push(entry);
    }

    const title = (formData.get('title') as string | null) ?? '';
    const text  = (formData.get('text')  as string | null) ?? '';
    const link  = (formData.get('url')   as string | null) ?? '';

    const nonce = crypto.randomUUID();
    const cache = await caches.open(SHARE_CACHE);

    // Store each file under /__share__/<nonce>/<index>-<filename>
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const key = `/__share__/${nonce}/${i}-${encodeURIComponent(file.name)}`;
      await cache.put(
        new Request(key),
        new Response(file, {
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-File-Name': file.name,
          },
        }),
      );
    }

    // Store the metadata (count, text) alongside
    const metaKey = `/__share__/${nonce}/__meta__.json`;
    await cache.put(
      new Request(metaKey),
      new Response(
        JSON.stringify({
          fileCount: files.length,
          title, text, url: link,
          ts: Date.now(),
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    );

    // Opportunistically GC older shares so the cache doesn't grow unbounded
    void gcShareCache(cache, nonce);

    return Response.redirect(`/AirGap/?shared=${nonce}`, 303);
  } catch (err) {
    console.error('[sw] share target failed', err);
    return Response.redirect('/AirGap/?shared=error', 303);
  }
}

/**
 * Keep only the most recent N share bundles. Old ones get evicted.
 */
async function gcShareCache(cache: Cache, keepNonce: string): Promise<void> {
  const MAX_SHARES = 5;
  const keys = await cache.keys();
  const byNonce = new Map<string, Request[]>();
  for (const req of keys) {
    const match = new URL(req.url).pathname.match(/^\/__share__\/([^/]+)\//);
    if (!match) continue;
    const nonce = match[1]!;
    if (!byNonce.has(nonce)) byNonce.set(nonce, []);
    byNonce.get(nonce)!.push(req);
  }
  if (byNonce.size <= MAX_SHARES) return;
  // Reads are cheap; sort by the latest meta ts if available, otherwise just
  // delete all but the kept + (MAX_SHARES-1) most-recently-added.
  const nonces = Array.from(byNonce.keys()).filter((n) => n !== keepNonce);
  const toEvict = nonces.slice(0, nonces.length - (MAX_SHARES - 1));
  for (const nonce of toEvict) {
    for (const req of byNonce.get(nonce) ?? []) {
      await cache.delete(req);
    }
  }
}

/* ─────────────── Lifecycle ─────────────── */

self.addEventListener('install', () => {
  // Skip waiting is opt-in from the UI (PWAUpdatePrompt calls updateSW(true)),
  // so we don't auto-activate mid-transfer.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
