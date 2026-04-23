import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Send, Download, QrCode, Shield, Zap, WifiOff } from 'lucide-react';
import { TransferMode } from './types';
import { initIntake, initialShortcutMode, onIntake, IntakeItem } from './utils/intake';
import { useToast } from './components/Toast';

// Lazy-load heavy routes so the landing screen ships as a tiny bundle.
const Sender = lazy(() => import('./components/Sender'));
const Receiver = lazy(() => import('./components/Receiver'));

const RouteFallback: React.FC = () => (
  <div className="h-[100dvh] w-screen bg-[#020617] flex flex-col items-center justify-center gap-6">
    <div className="relative">
      <div className="w-16 h-16 border-4 border-violet-500/20 rounded-full" />
      <div className="absolute inset-0 w-16 h-16 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
    <span className="text-xs font-black tracking-widest uppercase text-slate-500">Loading</span>
  </div>
);

function App() {
  // Honor shortcut deeplinks (?mode=send|receive) and pending share-target intake
  const [mode, setMode] = useState<TransferMode>(() => {
    const shortcut = initialShortcutMode();
    if (shortcut === 'send') return TransferMode.SEND;
    if (shortcut === 'receive') return TransferMode.RECEIVE;
    return TransferMode.IDLE;
  });
  const [pendingIntake, setPendingIntake] = useState<IntakeItem | null>(null);
  const toast = useToast();

  useEffect(() => {
    initIntake();
    const unsubscribe = onIntake((item) => {
      // Route to Sender regardless of current screen — sharing/opening
      // inherently means "I want to send this"
      setPendingIntake(item);
      setMode(TransferMode.SEND);
      if (item.kind === 'file') {
        toast.info(`Incoming · ${item.file.name}`);
      } else if (item.kind === 'text') {
        toast.info('Incoming shared text');
      }
    });
    return unsubscribe;
  }, [toast]);

  const clearPendingIntake = () => setPendingIntake(null);

  return (
    <div className="min-h-[100dvh] w-screen bg-[#020617] text-slate-100 flex flex-col font-sans">
      {mode === TransferMode.IDLE && (
        <main className="flex-1 flex flex-col items-center justify-center px-safe pt-safe pb-safe py-8 md:py-12">

          {/* Hero */}
          <header className="w-full max-w-4xl text-center px-4 space-y-3 md:space-y-4">
            <div className="flex items-center justify-center gap-3 md:gap-5">
              {/* Logo */}
              <div className="relative shrink-0 animate-float">
                <div className="absolute inset-0 bg-violet-600/30 blur-3xl rounded-full" />
                <div className="relative w-28 h-28 md:w-20 md:h-20 glass-card p-0 flex items-center justify-center border-violet-500/30">
                  <QrCode className="w-16 h-16 md:w-12 md:h-12 text-violet-400" />
                </div>
              </div>
              {/* Wordmark */}
              <h1 className="text-hero font-black tracking-tighter font-display bg-gradient-to-b from-white to-slate-500 bg-clip-text text-transparent leading-none">
                AirGap <span className="text-violet-500 uppercase">v2</span>
              </h1>
            </div>

            <p className="text-[var(--fs-base)] md:text-[var(--fs-lg)] text-slate-400 max-w-lg mx-auto leading-relaxed border-t border-white/5 pt-4">
              The future of local data transfer. No cloud. No cables. Just light.
            </p>
          </header>

          {/* Action buttons — 2 columns at every breakpoint */}
          <div className="w-full max-w-3xl grid grid-cols-2 gap-3 sm:gap-6 md:gap-8 mt-8 md:mt-12 px-4">
            <button
              onClick={() => setMode(TransferMode.SEND)}
              className="glass-card group flex flex-col items-center justify-center gap-3 sm:gap-6 border-violet-500/20 py-8 sm:py-14 md:py-16 px-3 sm:px-6 transition-transform active:scale-[0.98] hover:sm:scale-[1.02]"
              style={{ minHeight: '140px' }}
            >
              <div className="w-14 h-14 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-2xl sm:rounded-3xl bg-violet-600/20 flex items-center justify-center transition-all shadow-2xl shadow-violet-900/50 group-hover:bg-violet-600 group-active:bg-violet-600">
                <Send className="w-7 h-7 sm:w-10 sm:h-10 md:w-12 md:h-12 text-violet-400 group-hover:text-white group-active:text-white" />
              </div>
              <div className="text-center">
                <h3 className="text-lg sm:text-3xl font-black font-display text-white uppercase tracking-tighter italic">Broadcast</h3>
                <p className="text-slate-500 text-[9px] sm:text-xs font-bold uppercase tracking-widest mt-1">Send Droplets</p>
              </div>
            </button>

            <button
              onClick={() => setMode(TransferMode.RECEIVE)}
              className="glass-card group flex flex-col items-center justify-center gap-3 sm:gap-6 border-cyan-500/20 py-8 sm:py-14 md:py-16 px-3 sm:px-6 transition-transform active:scale-[0.98] hover:sm:scale-[1.02]"
              style={{ minHeight: '140px' }}
            >
              <div className="w-14 h-14 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-2xl sm:rounded-3xl bg-cyan-600/20 flex items-center justify-center transition-all shadow-2xl shadow-cyan-900/50 group-hover:bg-cyan-600 group-active:bg-cyan-600">
                <Download className="w-7 h-7 sm:w-10 sm:h-10 md:w-12 md:h-12 text-cyan-400 group-hover:text-white group-active:text-white" />
              </div>
              <div className="text-center">
                <h3 className="text-lg sm:text-3xl font-black font-display text-white uppercase tracking-tighter italic">Capture</h3>
                <p className="text-slate-500 text-[9px] sm:text-xs font-bold uppercase tracking-widest mt-1">Scan Droplets</p>
              </div>
            </button>
          </div>

          {/* Feature badges — tight flex that fits a 320-px viewport without scrolling */}
          <div className="w-full max-w-3xl mt-8 md:mt-12 px-4">
            <div className="flex flex-wrap justify-center gap-1.5 sm:gap-3">
              {[
                { icon: Shield,  label: 'AES-256 E2E' },
                { icon: WifiOff, label: 'Offline-first' },
                { icon: Zap,     label: 'Fountain codes' },
              ].map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="flex items-center gap-1 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2 glass rounded-full border-white/5"
                >
                  <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-violet-400 shrink-0" />
                  <span className="text-[9px] sm:text-[11px] font-bold tracking-wider uppercase text-slate-400 whitespace-nowrap">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </main>
      )}

      {mode !== TransferMode.IDLE && (
        <Suspense fallback={<RouteFallback />}>
          {mode === TransferMode.SEND && (
            <Sender
              onBack={() => setMode(TransferMode.IDLE)}
              initialItem={pendingIntake}
              onInitialItemConsumed={clearPendingIntake}
            />
          )}
          {mode === TransferMode.RECEIVE && <Receiver onBack={() => setMode(TransferMode.IDLE)} />}
        </Suspense>
      )}
    </div>
  );
}

export default App;
