import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeft, File as FileIcon, Play, Pause, Upload, Type, Settings, X,
  ChevronLeft, ChevronRight, Shield, Layers, Zap,
} from 'lucide-react';
import { processFile, generateQRData, generateUUID } from '../utils/protocol';
import { generateFountainFrames } from '../utils/fountain';
import QRDisplay from './QRDisplay';
import BottomSheet from './BottomSheet';
import { useToast } from './Toast';
import { DEFAULT_FRAME_DURATION, TRANSFER_LIMITS } from '../constants';
import type { IntakeItem } from '../utils/intake';

interface SenderProps {
  onBack: () => void;
  /** External intake (Open-With or Share-To). Consumed once on mount. */
  initialItem?: IntakeItem | null;
  onInitialItemConsumed?: () => void;
}

type DensityMode = 'STANDARD' | 'DUAL' | 'COLOR';
type ReliabilityMode = 'SEQUENTIAL' | 'FOUNTAIN';

const Sender: React.FC<SenderProps> = ({ onBack, initialItem, onInitialItemConsumed }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [qrFrames, setQrFrames] = useState<string[]>([]);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fps, setFps] = useState(1000 / DEFAULT_FRAME_DURATION);
  const [textInput, setTextInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [inputType, setInputType] = useState<'FILE' | 'TEXT'>('FILE');
  const [mode, setMode] = useState<DensityMode>('STANDARD');
  const [reliability, setReliability] = useState<ReliabilityMode>('SEQUENTIAL');
  const [keyId, setKeyId] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const toast = useToast();

  const startProcessing = useCallback(async (selectedFile: File) => {
    // Enforce the file-size limit before we consume any memory on read/compress
    if (selectedFile.size > TRANSFER_LIMITS.MAX_FILE_SIZE) {
      const mb = (selectedFile.size / 1024 / 1024).toFixed(1);
      const limitMb = Math.floor(TRANSFER_LIMITS.MAX_FILE_SIZE / 1024 / 1024);
      toast.error(`File too large — ${mb} MB exceeds the ${limitMb} MB limit.`);
      return;
    }
    if (selectedFile.size === 0) {
      toast.error('File is empty.');
      return;
    }

    setFile(selectedFile);
    setIsProcessing(true);
    setKeyId(null);

    try {
      await new Promise((r) => setTimeout(r, 300));
      const fileId = generateUUID();
      const { payload, bytes, checksum, seal } = await processFile(selectedFile);

      const frames = reliability === 'FOUNTAIN'
        ? generateFountainFrames(fileId, selectedFile, payload, checksum, seal, bytes)
        : generateQRData(fileId, selectedFile, payload, checksum, seal);

      setKeyId(seal.keyId);
      setQrFrames(frames);
      setCurrentFrameIndex(0);
      setIsProcessing(false);
      setIsPlaying(true);
      toast.success(`Ready · ${frames.length} frames · key ${seal.keyId}`);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to process file.');
      setIsProcessing(false);
      setFile(null);
    }
  }, [reliability, toast]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) startProcessing(e.target.files[0]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files[0]) startProcessing(e.dataTransfer.files[0]);
  };

  const handleTextSubmit = () => {
    if (!textInput.trim()) return;
    const blob = new Blob([textInput], { type: 'text/plain' });
    const f = new File([blob], 'message.txt', { type: 'text/plain', lastModified: Date.now() });
    startProcessing(f);
  };

  const getStep = useCallback(() => {
    if (mode === 'DUAL') return 2;
    if (mode === 'COLOR') return 3;
    return 1;
  }, [mode]);

  const handlePrevFrame = () => {
    setIsPlaying(false);
    setCurrentFrameIndex((prev) => Math.max(0, prev - getStep()));
  };

  const handleNextFrame = () => {
    setIsPlaying(false);
    setCurrentFrameIndex((prev) => Math.min(qrFrames.length - 1, prev + getStep()));
  };

  // Consume external intake (File Handlers, Share Target) once on mount.
  // If it's text we drop into the TEXT tab with the value pre-filled;
  // if it's a file we go straight to processing.
  useEffect(() => {
    if (!initialItem) return;
    if (initialItem.kind === 'file') {
      void startProcessing(initialItem.file);
    } else if (initialItem.kind === 'text') {
      setInputType('TEXT');
      setTextInput(initialItem.text);
    }
    onInitialItemConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialItem]);

  useEffect(() => {
    let interval: number | undefined;
    if (isPlaying && qrFrames.length > 0) {
      interval = window.setInterval(() => {
        setCurrentFrameIndex((prev) => {
          const step = getStep();
          const next = prev + step;
          return next >= qrFrames.length ? 0 : next;
        });
      }, 1000 / fps);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isPlaying, fps, qrFrames.length, getStep]);

  const frame1 = qrFrames[currentFrameIndex];
  const frame2 = currentFrameIndex + 1 < qrFrames.length ? qrFrames[currentFrameIndex + 1] : null;
  const frame3 = currentFrameIndex + 2 < qrFrames.length ? qrFrames[currentFrameIndex + 2] : null;

  const isSeal = currentFrameIndex === 0;
  const isHeader = currentFrameIndex === 1;
  const dataIndex = currentFrameIndex - 2;

  const reset = () => {
    setFile(null);
    setQrFrames([]);
    setIsPlaying(false);
    setKeyId(null);
    setCurrentFrameIndex(0);
  };

  const badgeLabel = useMemo(() => {
    if (isSeal) return { text: `Seal${keyId ? ` · ${keyId}` : ''}`, tone: 'bg-emerald-600 text-white', icon: <Shield className="w-3 h-3" /> };
    if (isHeader) return { text: 'Header', tone: 'bg-violet-600 text-white', icon: null };
    return { text: `Seq #${dataIndex}`, tone: 'bg-slate-900 text-slate-300 border border-white/10', icon: null };
  }, [isSeal, isHeader, dataIndex, keyId]);

  return (
    <div className="flex flex-col min-h-[100dvh] bg-[#020617] text-slate-100 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-violet-600/10 blur-[120px] rounded-full pointer-events-none" />

      {/* Top bar — safe-area aware */}
      <div
        className="flex items-center justify-between px-4 md:px-6 z-10"
        style={{ paddingTop: `max(env(safe-area-inset-top, 0px), 1rem)`, paddingBottom: '0.5rem' }}
      >
        <button onClick={onBack} aria-label="Back" className="btn-icon bg-white/5 hover:bg-white/10 border border-white/5">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl md:text-2xl font-black font-display tracking-tight text-white">Broadcast</h1>
        <div className="w-11" /> {/* spacer */}
      </div>

      {!file ? (
        // ─────────────── PICKER VIEW ───────────────
        <div className="flex-1 flex flex-col w-full max-w-lg mx-auto px-4 md:px-6 py-4 z-10">
          {/* Input-type toggle */}
          <div className="flex glass p-1.5 rounded-2xl mb-6 border-white/5 sticky top-0 z-10">
            <button
              onClick={() => setInputType('FILE')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                inputType === 'FILE' ? 'bg-violet-600 text-white shadow-lg' : 'text-slate-500'
              }`}
              style={{ minHeight: 44 }}
            >
              Files
            </button>
            <button
              onClick={() => setInputType('TEXT')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                inputType === 'TEXT' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500'
              }`}
              style={{ minHeight: 44 }}
            >
              Pure Text
            </button>
          </div>

          <div className="flex-1 flex flex-col justify-center min-h-[50dvh]">
            {inputType === 'FILE' ? (
              <div className="w-full animate-in zoom-in-95 duration-300">
                <input type="file" id="file-upload" className="hidden" onChange={handleFileChange} />
                <label
                  htmlFor="file-upload"
                  onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
                  onDragLeave={() => setIsDraggingOver(false)}
                  onDrop={handleDrop}
                  className={`group flex flex-col items-center justify-center w-full aspect-[4/5] sm:aspect-[4/3] md:aspect-[5/4] max-h-[60vh] glass-card cursor-pointer relative overflow-hidden transition-all ${
                    isDraggingOver ? 'border-violet-500 bg-violet-600/10' : 'border-white/5'
                  }`}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-violet-600/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className={`relative w-20 h-20 md:w-24 md:h-24 rounded-3xl flex items-center justify-center mb-6 transition-all ${
                    isDraggingOver ? 'bg-violet-600 text-white scale-110' : 'bg-violet-600/20 text-violet-400'
                  }`}>
                    <Upload className="w-10 h-10 md:w-12 md:h-12" />
                  </div>
                  <span className="text-xl md:text-2xl font-bold font-display text-slate-100 mb-2">Select assets</span>
                  <span className="text-xs md:text-sm text-slate-500 text-center max-w-[240px] px-4">
                    Tap to pick, or drop images, videos, docs
                  </span>
                  <span className="text-[10px] text-slate-600 mt-4 font-bold tracking-widest uppercase">
                    Max {Math.floor(TRANSFER_LIMITS.MAX_FILE_SIZE / 1024 / 1024)} MB
                  </span>
                </label>
              </div>
            ) : (
              <div className="w-full flex flex-col h-full animate-in slide-in-from-bottom-4 duration-300">
                <textarea
                  className="flex-1 min-h-[50dvh] md:min-h-[40dvh] w-full glass rounded-3xl p-4 md:p-6 text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 border-white/5 resize-none mb-4 shadow-inner text-base"
                  placeholder="Paste text or links here..."
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                />
                <button
                  onClick={handleTextSubmit}
                  disabled={!textInput.trim()}
                  className="btn-premium btn-primary w-full h-14 text-base border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Type className="w-5 h-5 mr-2" />
                  Generate droplets
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        // ─────────────── BROADCAST VIEW ───────────────
        <div className="flex-1 flex flex-col items-center w-full min-h-0 z-10 px-4 md:px-6 pb-safe">
          {isProcessing ? (
            <div className="flex-1 flex flex-col items-center justify-center">
              <div className="relative">
                <div className="w-16 h-16 md:w-20 md:h-20 border-4 border-violet-500/20 rounded-full" />
                <div className="absolute inset-0 w-16 h-16 md:w-20 md:h-20 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
              </div>
              <h3 className="mt-6 text-xl md:text-2xl font-black font-display text-white">Encrypting</h3>
              <p className="text-slate-500 mt-1 text-xs md:text-sm text-center px-4">AES-256-GCM · zlib · Base45</p>
            </div>
          ) : (
            <>
              {/* File Info Pill */}
              <div className="glass px-4 py-2.5 rounded-2xl flex items-center gap-3 border-white/5 shadow-xl mb-4 md:mb-6 max-w-full">
                <div className="p-1.5 bg-violet-600/10 rounded-lg shrink-0">
                  <FileIcon className="w-4 h-4 text-violet-400" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold truncate text-slate-200">{file.name}</span>
                  <span className="text-[10px] text-slate-500 flex items-center gap-2 flex-wrap">
                    <span>{(file.size / 1024).toFixed(0)} KB</span>
                    {keyId && (
                      <span className="flex items-center gap-1 text-emerald-400">
                        <Shield className="w-2.5 h-2.5" /> {keyId}
                      </span>
                    )}
                    {reliability === 'FOUNTAIN' && (
                      <span className="flex items-center gap-1 text-cyan-400">
                        <Zap className="w-2.5 h-2.5" /> Fountain
                      </span>
                    )}
                  </span>
                </div>
                <button
                  onClick={reset}
                  aria-label="Clear file"
                  className="btn-icon ml-auto -mr-1 text-slate-500 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* QR Stage — fluid size, centered */}
              <div className="flex-1 w-full flex items-center justify-center min-h-0 py-2 md:py-4 relative">
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-[60%] h-[60%] max-w-[300px] max-h-[300px] bg-violet-600/5 blur-[80px] rounded-full" />
                </div>

                {mode === 'STANDARD' && frame1 && (
                  <div
                    className="p-3 md:p-4 bg-white rounded-3xl shadow-[0_0_50px_rgba(139,92,246,0.3)] flex items-center justify-center relative animate-in scale-95 fade-in duration-300"
                    style={{ width: 'min(85vw, 55dvh, 420px)', height: 'min(85vw, 55dvh, 420px)' }}
                  >
                    <QRDisplay value={frame1} className="w-full h-full" />
                    <div className={`absolute -bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-xl text-[10px] font-black tracking-widest uppercase shadow-xl z-20 flex items-center gap-1.5 whitespace-nowrap ${badgeLabel.tone}`}>
                      {badgeLabel.icon}{badgeLabel.text}
                    </div>
                  </div>
                )}

                {mode === 'DUAL' && (
                  <div
                    className="flex items-center justify-center gap-3 md:gap-4 animate-in scale-95 fade-in duration-300"
                    style={{ width: 'min(92vw, 60dvh, 680px)' }}
                  >
                    {[frame1, frame2].map((f, i) => (
                      <div key={i} className="relative flex-1 aspect-square bg-white rounded-2xl shadow-xl flex items-center justify-center p-2">
                        {f ? <QRDisplay value={f} className="w-full h-full" /> : <div className="text-slate-200 font-bold">END</div>}
                        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-lg text-[8px] font-black bg-slate-900 text-white border border-white/10">
                          {i === 0 ? `L-${currentFrameIndex}` : `R-${currentFrameIndex + 1}`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {mode === 'COLOR' && (
                  <div
                    className="bg-white rounded-3xl shadow-2xl relative overflow-hidden animate-in scale-95 fade-in duration-300"
                    style={{ width: 'min(85vw, 55dvh, 420px)', height: 'min(85vw, 55dvh, 420px)' }}
                  >
                    {frame1 && <div className="absolute inset-0 p-3 md:p-4 mix-blend-multiply flex items-center justify-center"><QRDisplay value={frame1} fgColor="#00FFFF" bgColor="transparent" className="w-full h-full" /></div>}
                    {frame2 && <div className="absolute inset-0 p-3 md:p-4 mix-blend-multiply flex items-center justify-center"><QRDisplay value={frame2} fgColor="#FF00FF" bgColor="transparent" className="w-full h-full" /></div>}
                    {frame3 && <div className="absolute inset-0 p-3 md:p-4 mix-blend-multiply flex items-center justify-center"><QRDisplay value={frame3} fgColor="#FFFF00" bgColor="transparent" className="w-full h-full" /></div>}
                  </div>
                )}
              </div>

              {/* Sticky bottom controls */}
              <div
                className="w-full max-w-md shrink-0 bg-white/5 border border-white/5 rounded-3xl p-3 md:p-4 backdrop-blur-md shadow-xl space-y-3 mt-4"
                style={{ marginBottom: `max(env(safe-area-inset-bottom, 0px), 1rem)` }}
              >
                {/* Progress scrubber */}
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[10px] font-black font-mono text-slate-500 w-6 text-right tabular-nums">{currentFrameIndex}</span>
                  <div className="flex-1 h-2 bg-slate-800 rounded-full relative overflow-hidden">
                    <input
                      type="range"
                      min="0"
                      max={Math.max(0, qrFrames.length - 1)}
                      value={currentFrameIndex}
                      onChange={(e) => { setIsPlaying(false); setCurrentFrameIndex(parseInt(e.target.value, 10)); }}
                      aria-label="Frame scrubber"
                      className="absolute inset-0 w-full h-full opacity-0 z-20 cursor-pointer"
                    />
                    <div
                      className="absolute top-0 left-0 h-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-[width] duration-100"
                      style={{ width: `${(currentFrameIndex / Math.max(1, qrFrames.length - 1)) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-black font-mono text-slate-500 w-8 tabular-nums">{qrFrames.length - 1}</span>
                </div>

                {/* Transport row */}
                <div className="flex items-center justify-between px-2">
                  <button
                    onClick={handlePrevFrame}
                    aria-label="Previous frame"
                    className="btn-icon text-slate-400 hover:text-white"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>

                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                    className="w-14 h-14 flex items-center justify-center bg-white text-slate-900 rounded-full shadow-lg active:scale-90 transition-transform"
                  >
                    {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-0.5" />}
                  </button>

                  <button
                    onClick={handleNextFrame}
                    aria-label="Next frame"
                    className="btn-icon text-slate-400 hover:text-white"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>

                  <button
                    onClick={() => setShowSettings(true)}
                    aria-label="Settings"
                    className="btn-icon text-slate-400 hover:text-white"
                  >
                    <Settings className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Settings — bottom sheet on mobile, modal on desktop */}
      <BottomSheet open={showSettings} onClose={() => setShowSettings(false)} title="Broadcast settings">
        <div className="space-y-6 pt-2">
          {/* Density Mode */}
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 block">
              Density mode
            </label>
            <div className="grid grid-cols-3 gap-2 p-1 bg-slate-900/50 rounded-2xl border border-white/5">
              {([
                { id: 'STANDARD' as const, label: '1×', active: 'bg-violet-600' },
                { id: 'DUAL'     as const, label: '2×', active: 'bg-indigo-600' },
                { id: 'COLOR'    as const, label: '3×', active: 'bg-cyan-600' },
              ]).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  style={{ minHeight: 44 }}
                  className={`rounded-xl text-xs font-black tracking-widest uppercase transition-colors ${
                    mode === m.id ? `${m.active} text-white shadow-lg` : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-500 mt-2 leading-snug">
              2× renders side-by-side. 3× composites CMY channels — receiver demultiplexes R/G/B.
            </p>
          </div>

          {/* Reliability */}
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 block flex items-center gap-1.5">
              <Layers className="w-3 h-3" /> Reliability
            </label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-900/50 rounded-2xl border border-white/5">
              {([
                { id: 'SEQUENTIAL' as const, label: 'Sequential' },
                { id: 'FOUNTAIN'   as const, label: 'Fountain' },
              ]).map((r) => (
                <button
                  key={r.id}
                  onClick={() => setReliability(r.id)}
                  disabled={!!file}
                  style={{ minHeight: 44 }}
                  className={`rounded-xl text-xs font-black tracking-wider uppercase transition-colors ${
                    reliability === r.id ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-500 mt-2 leading-snug">
              Fountain = LT codes. Any chunk can be missed; decoder reconstructs from any sufficient set of droplets.
            </p>
          </div>

          {/* FPS */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Velocity</label>
              <span className="text-sm font-mono text-violet-400 font-bold tabular-nums">{fps.toFixed(1)} FPS</span>
            </div>
            <input
              type="range"
              min="1"
              max="20"
              step="0.5"
              value={fps}
              onChange={(e) => setFps(parseFloat(e.target.value))}
              className="w-full"
              aria-label="Frames per second"
            />
            <div className="flex justify-between text-[9px] text-slate-600 font-bold uppercase tracking-tight mt-1">
              <span>Slow · Reliable</span>
              <span>Turbo · Lossy</span>
            </div>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
};

export default Sender;
