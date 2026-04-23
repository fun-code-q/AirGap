/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Vite's `?url` suffix imports return the asset's public URL as a string.
// Needed for self-hosted pdf.js worker.
declare module '*?url' {
  const url: string;
  export default url;
}

// vite-plugin-pwa virtual module — service worker registration hooks.
declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (sw: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: unknown) => void;
  }
  export function registerSW(
    options?: RegisterSWOptions,
  ): (reloadPage?: boolean) => Promise<void>;
}
