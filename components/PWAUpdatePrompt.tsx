import React, { useEffect, useState } from 'react';
import { RefreshCw, Wifi, X } from 'lucide-react';

type RegisterSW = (opts: {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
}) => (reload?: boolean) => Promise<void>;

/**
 * Talks to vite-plugin-pwa's virtual:pwa-register module. Dynamic import so the
 * component stays inert when the plugin isn't active (e.g. `vite dev` without
 * devOptions, or the test runner).
 */
const PWAUpdatePrompt: React.FC = () => {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [updateSW, setUpdateSW] = useState<((reload?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import(/* @vite-ignore */ 'virtual:pwa-register');
        if (cancelled) return;
        const register = mod.registerSW as RegisterSW;
        const update = register({
          onNeedRefresh: () => setNeedRefresh(true),
          onOfflineReady: () => setOfflineReady(true),
        });
        setUpdateSW(() => update);
      } catch {
        // Plugin not active — nothing to show
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!needRefresh && !offlineReady) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-4 duration-500">
      {needRefresh && (
        <div className="glass-card flex items-center gap-3 px-5 py-3 border-violet-500/30 shadow-[0_0_40px_rgba(139,92,246,0.25)]">
          <div className="w-8 h-8 bg-violet-600/20 rounded-xl flex items-center justify-center">
            <RefreshCw className="w-4 h-4 text-violet-400" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-white">New version available</span>
            <span className="text-[10px] text-slate-500 uppercase tracking-widest">Reload to update</span>
          </div>
          <button
            onClick={() => updateSW?.(true)}
            className="ml-2 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-black tracking-widest uppercase transition-colors"
          >
            Reload
          </button>
          <button
            onClick={() => setNeedRefresh(false)}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Dismiss update prompt"
          >
            <X className="w-3.5 h-3.5 text-slate-500" />
          </button>
        </div>
      )}
      {!needRefresh && offlineReady && (
        <div className="glass-card flex items-center gap-3 px-5 py-3 border-emerald-500/20">
          <div className="w-8 h-8 bg-emerald-600/20 rounded-xl flex items-center justify-center">
            <Wifi className="w-4 h-4 text-emerald-400" />
          </div>
          <span className="text-xs font-bold text-slate-200">Ready to work offline</span>
          <button
            onClick={() => setOfflineReady(false)}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Dismiss offline notice"
          >
            <X className="w-3.5 h-3.5 text-slate-500" />
          </button>
        </div>
      )}
    </div>
  );
};

export default PWAUpdatePrompt;
