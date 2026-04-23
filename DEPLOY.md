# AirGap v2 — Deployment Guide

AirGap is a 100% static PWA. There is no server logic to deploy. But it is a PWA
with camera access, a Service Worker, and Share Target handling, so the hosting
environment must be configured correctly.

## Hard requirements

| Requirement | Why |
|---|---|
| **HTTPS** (or `localhost` in dev) | `getUserMedia` (camera), Service Worker, Web Crypto, File Handlers all require a secure context. |
| **HTTP/2 or HTTP/3** | Not strictly required, but dozens of precached chunks benefit meaningfully from multiplexing. |
| **Correct cache headers** | `sw.js` must NOT be cached — see below — or users will be stuck on old versions forever. |
| **CORS-enabled font fetches** | `https://fonts.gstatic.com` is preflight-clean by default; nothing to configure. |

## Cache-control policy

| Path pattern | `Cache-Control` | Reason |
|---|---|---|
| `/sw.js` | `public, max-age=0, must-revalidate` | The SW itself must always be re-validated so new versions roll out. |
| `/index.html` | `public, max-age=0, must-revalidate` | App shell — same rule. |
| `/manifest.webmanifest` | `public, max-age=3600` | Can change between deploys; short TTL. |
| `/assets/*` | `public, max-age=31536000, immutable` | Vite hashes these filenames; they're safe to cache forever. |

## Content-Security-Policy

The project sets a CSP via `<meta http-equiv>` in [index.html](index.html).
You **should also set it as an HTTP header** — meta-tag CSP doesn't support
`frame-ancestors`, `report-uri`, or `sandbox`.

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com data:;
  img-src 'self' data: blob:;
  media-src 'self' blob:;
  worker-src 'self' blob:;
  connect-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
```

Other recommended headers:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: same-origin
Permissions-Policy: camera=(self), microphone=(), geolocation=(), interest-cohort=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

Camera must be listed in `Permissions-Policy` — otherwise the scanner can't open.

## Nginx example

```nginx
server {
    listen 443 ssl http2;
    server_name airgap.example.com;

    ssl_certificate     /etc/letsencrypt/live/airgap.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/airgap.example.com/privkey.pem;

    root /var/www/airgap/dist;
    index index.html;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "same-origin" always;
    add_header Permissions-Policy "camera=(self), microphone=(), geolocation=(), interest-cohort=()" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';" always;

    # Cache-busting: SW and shell never cached
    location = /sw.js {
        add_header Cache-Control "public, max-age=0, must-revalidate" always;
    }
    location = /index.html {
        add_header Cache-Control "public, max-age=0, must-revalidate" always;
    }
    location = /manifest.webmanifest {
        add_header Cache-Control "public, max-age=3600" always;
        types { application/manifest+json webmanifest; }
    }

    # Hashed assets — immutable
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files $uri =404;
    }

    # SPA fallback — let the SW's navigation route take over if it's registered,
    # otherwise serve index.html. Must NOT fallback for the share_target POST.
    location / {
        if ($request_method = POST) {
            # Share Target lands here; let it through so the SW intercepts
            return 200;
        }
        try_files $uri $uri/ /index.html;
    }
}
```

## Caddy example

```caddy
airgap.example.com {
    root * /var/www/airgap/dist
    file_server
    encode gzip zstd

    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "same-origin"
        Permissions-Policy "camera=(self), microphone=(), geolocation=(), interest-cohort=()"
        Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';"
    }

    @sw path /sw.js /index.html
    header @sw Cache-Control "public, max-age=0, must-revalidate"

    @assets path /assets/*
    header @assets Cache-Control "public, max-age=31536000, immutable"

    try_files {path} /index.html
}
```

## Docker (nginx-alpine)

```dockerfile
# ─── Build stage ─────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# ─── Runtime stage ───────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Put the nginx server block above into `deploy/nginx.conf` (strip the `ssl_*`
and `listen` lines if you're terminating TLS at a load balancer).

## Static-host shortcuts

### Cloudflare Pages
Drop [`public/_headers`](#public_headers-for-cloudflarenetlify) into `public/`
and set:
- **Build command**: `npm run build`
- **Build output**: `dist`
- **Node version**: 22

### Netlify
Same `_headers` file as Cloudflare. Uses [`netlify.toml`](#netlify.toml):

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
  conditions = { Method = ["GET"] }
```

### Vercel
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "headers": [
    {
      "source": "/sw.js",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }]
    },
    {
      "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }
  ],
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### `public/_headers` for Cloudflare/Netlify
```
/sw.js
  Cache-Control: public, max-age=0, must-revalidate

/index.html
  Cache-Control: public, max-age=0, must-revalidate

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/*
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  Referrer-Policy: same-origin
  Permissions-Policy: camera=(self), microphone=(), geolocation=(), interest-cohort=()
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

## Post-deploy verification

Before announcing a release, run through this checklist on the deployed URL:

1. **Lighthouse PWA score** — should be ≥ 90; "installable" must be ✅.
2. **Install to home screen** (iOS Safari + Android Chrome). The icon should be
   crisp (uses the PNG from the asset generator, not the SVG fallback).
3. **Camera permission** — open Capture → browser should prompt for camera
   access exactly once; denial should surface an in-app error.
4. **Open-with from Files app / explorer** — right-click a PDF → "Open with
   AirGap". File should auto-load in the Sender view.
5. **Share to AirGap** — from another app's share sheet (photo, text note).
   Should redirect to AirGap with the item pre-loaded.
6. **Shortcut deeplink** — launching from the installed app's long-press
   shortcut should land directly on Send / Receive.
7. **Offline test** — toggle airplane mode after first load. Everything should
   still work including file previews (PDF worker is self-hosted).
8. **SW update flow** — deploy a new version, keep the old tab open. A toast
   with "Reload" should appear within a minute.
9. **Header audit** — `securityheaders.com` should give an A or A+.

## Known limitations in production

- **iOS PWA** doesn't yet support the File Handlers API. "Open with AirGap"
  works on Android/desktop Chromium only.
- **Share Target file uploads** require a browser with both Service Worker
  scope and `share_target.files` support (Android Chrome, Edge). iOS Safari
  currently passes text/URL only via GET — already handled.
- **Color-mode scanning** depends on camera color fidelity. Under warm
  tungsten lighting, R-channel bleed can cause the demux to fall back to
  grayscale. Test in your deployment's expected lighting conditions.
