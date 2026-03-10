import React, { useState } from 'react';
import { Send, Download, QrCode } from 'lucide-react';
import Sender from './components/Sender';
import Receiver from './components/Receiver';
import { TransferMode } from './types';

function App() {
  const [mode, setMode] = useState<TransferMode>(TransferMode.IDLE);

  return (
    <div className="h-[100dvh] w-screen bg-[#020617] overflow-hidden text-slate-100 flex flex-col font-sans">
      {mode === TransferMode.IDLE && (
        <main className="flex-1 overflow-y-auto custom-scrollbar p-6 flex flex-col items-center justify-center">

          {/* Hero Section */}
          <header className="w-full max-w-4xl text-center pt-12 pb-12 space-y-6">
            <div className="relative inline-block animate-float">
              <div className="absolute inset-0 bg-violet-600/30 blur-3xl rounded-full"></div>
              <div className="relative w-24 h-24 glass-card p-0 flex items-center justify-center mx-auto border-violet-500/30">
                <QrCode className="w-12 h-12 text-violet-400" />
              </div>
            </div>

            <div className="space-y-2">
              <h1 className="text-5xl md:text-7xl font-black tracking-tighter font-display bg-gradient-to-b from-white to-slate-500 bg-clip-text text-transparent">
                AirGap <span className="text-violet-500 uppercase">v2</span>
              </h1>
              <p className="text-xl text-slate-400 max-w-lg mx-auto leading-relaxed border-t border-white/5 pt-4">
                The future of local data transfer. No cloud. No cables. Just light.
              </p>
            </div>
          </header>

          {/* Action Section */}
          <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
            <button
              onClick={() => setMode(TransferMode.SEND)}
              className="glass-card group flex flex-col items-center justify-center space-y-6 hover:bg-violet-600/20 border-violet-500/20 py-16 transition-all duration-500 hover:scale-[1.02]"
            >
              <div className="w-24 h-24 rounded-3xl bg-violet-600/20 flex items-center justify-center group-hover:bg-violet-600 transition-all duration-500 shadow-2xl shadow-violet-900/50">
                <Send className="w-12 h-12 text-violet-400 group-hover:text-white" />
              </div>
              <div className="text-center">
                <h3 className="text-3xl font-black font-display text-white uppercase tracking-tighter italic">Broadcast</h3>
                <p className="text-slate-500 text-sm font-bold uppercase tracking-widest mt-1">Send Droplets</p>
              </div>
            </button>

            <button
              onClick={() => setMode(TransferMode.RECEIVE)}
              className="glass-card group flex flex-col items-center justify-center space-y-6 hover:bg-cyan-600/20 border-cyan-500/20 py-16 transition-all duration-500 hover:scale-[1.02]"
            >
              <div className="w-24 h-24 rounded-3xl bg-cyan-600/20 flex items-center justify-center group-hover:bg-cyan-600 transition-all duration-500 shadow-2xl shadow-cyan-900/50">
                <Download className="w-12 h-12 text-cyan-400 group-hover:text-white" />
              </div>
              <div className="text-center">
                <h3 className="text-3xl font-black font-display text-white uppercase tracking-tighter italic">Capture</h3>
                <p className="text-slate-500 text-sm font-bold uppercase tracking-widest mt-1">Scan Droplets</p>
              </div>
            </button>
          </div>

        </main>
      )}

      {mode === TransferMode.SEND && (
        <Sender onBack={() => setMode(TransferMode.IDLE)} />
      )}

      {mode === TransferMode.RECEIVE && (
        <Receiver onBack={() => setMode(TransferMode.IDLE)} />
      )}
    </div>
  );
}

export default App;
