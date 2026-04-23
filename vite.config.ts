import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: '.',
      filename: 'sw.ts',
      // prompt = ask the user before activating a new SW (we show a toast)
      registerType: 'prompt',
      injectRegister: false, // we call registerSW() ourselves in PWAUpdatePrompt
      includeAssets: [
        'favicon.ico',
        'apple-touch-icon-180x180.png',
        'icon.svg',
      ],
      manifest: {
        name: 'AirGap — Offline QR Transfer',
        short_name: 'AirGap',
        description:
          'Secure offline file transfer via animated QR codes. No cloud, no cables, no network.',
        theme_color: '#020617',
        background_color: '#020617',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['productivity', 'utilities', 'security'],
        icons: [
          { src: 'pwa-64x64.png',            sizes: '64x64',   type: 'image/png' },
          { src: 'pwa-192x192.png',          sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png',          sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          // Keep the SVG for browsers that prefer vector
          { src: 'icon.svg',                  sizes: 'any',     type: 'image/svg+xml' },
        ],
        // Let the OS hand files directly to AirGap as "Open with…"
        file_handlers: [
          {
            action: '/',
            accept: {
              'application/pdf': ['.pdf'],
              'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
              'text/*': ['.txt', '.md', '.csv', '.json', '.html', '.xml'],
              'video/*': ['.mp4', '.webm'],
              'audio/*': ['.mp3', '.wav', '.ogg'],
              'application/*': ['.docx', '.xlsx', '.zip'],
            },
          },
        ],
        // Accept Web-Share-Target posts: "Share to AirGap" from any app
        share_target: {
          action: '/',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [
              {
                name: 'files',
                accept: ['*/*'],
              },
            ],
          },
        },
        shortcuts: [
          {
            name: 'Send',
            short_name: 'Send',
            description: 'Broadcast a file via QR',
            url: '/?mode=send',
          },
          {
            name: 'Receive',
            short_name: 'Receive',
            description: 'Scan inbound QR stream',
            url: '/?mode=receive',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // pdf.js worker is ~1 MB
      },
      devOptions: {
        enabled: false,
      },
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  server: {
    port: 3000,
    host: true
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    exclude: ['node_modules', 'dist', 'e2e/**'],
  }
})
