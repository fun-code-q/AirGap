import {
  defineConfig,
  minimal2023Preset as preset,
} from '@vite-pwa/assets-generator/config';

// Takes public/icon.svg and produces:
//   apple-touch-icon.png            (180×180, solid background for iOS)
//   favicon.ico
//   pwa-64x64.png
//   pwa-192x192.png
//   pwa-512x512.png
//   maskable-icon-512x512.png       (with padding for Android safe zone)
// Output goes to public/ alongside the source SVG.
export default defineConfig({
  preset,
  images: ['public/icon.svg'],
});
