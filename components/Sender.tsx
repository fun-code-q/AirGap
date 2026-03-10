import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, File as FileIcon, Play, Pause, Upload, Type, Settings, X, ChevronLeft, ChevronRight, Sun, Layers } from 'lucide-react';
import { processFile, generateQRData, generateUUID } from '../utils/protocol';
import QRDisplay from './QRDisplay';
import { DEFAULT_FRAME_DURATION } from '../constants';

interface SenderProps {
  onBack: () => void;
}

const Sender: React.FC<SenderProps> = ({ onBack }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [qrFrames, setQrFrames] = useState<string[]>([]);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fps, setFps] = useState(1000 / DEFAULT_FRAME_DURATION);
  const [textInput, setTextInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [inputType, setInputType] = useState<'FILE' | 'TEXT'>('FILE');
  const [mode, setMode] = useState<'STANDARD' | 'DUAL' | 'COLOR'>('STANDARD');

  const startProcessing = async (selectedFile: File) => {
    setFile(selectedFile);
    setIsProcessing(true);

    try {
      await new Promise(resolve => setTimeout(resolve, 800)); // Smooth transition

      const fileId = generateUUID();
      const { payload, checksum } = await processFile(selectedFile);
      const frames = generateQRData(fileId, selectedFile, payload, checksum);

      setQrFrames(frames);
      setCurrentFrameIndex(0);
      setIsProcessing(false);
      setIsPlaying(true);
    } catch (err) {
      console.error(err);
      alert("Error processing file.");
      setIsProcessing(false);
      setFile(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      startProcessing(e.target.files[0]);
    }
  };

  const handleTextSubmit = () => {
    if (!textInput.trim()) return;
    const blob = new Blob([textInput], { type: 'text/plain' });
    const file = new File([blob], "message.txt", { type: "text/plain", lastModified: Date.now() });
    startProcessing(file);
  };

  const getStep = () => {
    if (mode === 'DUAL') return 2;
    if (mode === 'COLOR') return 3;
    return 1;
  };

  const handlePrevFrame = () => {
    setIsPlaying(false);
    setCurrentFrameIndex((prev) => Math.max(0, prev - getStep()));
  };

  const handleNextFrame = () => {
    setIsPlaying(false);
    setCurrentFrameIndex((prev) => Math.min(qrFrames.length - 1, prev + getStep()));
  };

  useEffect(() => {
    let interval: number;
    if (isPlaying && qrFrames.length > 0) {
      interval = window.setInterval(() => {
        setCurrentFrameIndex((prev) => {
          const step = getStep();
          const next = prev + step;
          return next >= qrFrames.length ? 0 : next;
        });
      }, 1000 / fps);
    }
    return () => clearInterval(interval);
  }, [isPlaying, fps, qrFrames.length, mode]);

  const frame1 = qrFrames[currentFrameIndex];
  const frame2 = (currentFrameIndex + 1 < qrFrames.length) ? qrFrames[currentFrameIndex + 1] : null;
  const frame3 = (currentFrameIndex + 2 < qrFrames.length) ? qrFrames[currentFrameIndex + 2] : null;

  const isHeader = currentFrameIndex === 0;

  return (
    <div className="flex flex-col h-full bg-[#020617] text-slate-100 p-6 relative overflow-hidden">

      {/* Background Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-violet-600/10 blur-[120px] rounded-full pointer-events-none"></div>

      {/* Header */}
      <div className="flex items-center justify-between mb-8 z-10">
        <button
          onClick={onBack}
          className="p-3 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 transition-all active:scale-95"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-2xl font-black font-display tracking-tight text-white">
          Broadcast
        </h1>
        <div className="w-12"></div> {/* Spacer */}
      </div>

      {!file ? (
        <div className="flex-1 flex flex-col w-full max-w-lg mx-auto overflow-hidden z-10">

          {/* Toggle */}
          <div className="flex glass p-1.5 rounded-2xl mb-8 border-white/5">
            <button
              onClick={() => setInputType('FILE')}
              className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${inputType === 'FILE' ? 'bg-violet-600 text-white shadow-lg' : 'text-slate-500 hover:text-white'}`}
            >
              Files
            </button>
            <button
              onClick={() => setInputType('TEXT')}
              className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${inputType === 'TEXT' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-white'}`}
            >
              Pure Text
            </button>
          </div>

          <div className="flex-1 flex flex-col justify-center">
            {inputType === 'FILE' ? (
              <div className="w-full animate-in zoom-in-95 duration-500">
                <input type="file" id="file-upload" className="hidden" onChange={handleFileChange} />
                <label
                  htmlFor="file-upload"
                  className="group flex flex-col items-center justify-center w-full h-80 glass-card cursor-pointer border-white/5 hover:border-violet-500/40 relative overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-violet-600/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  <div className="relative w-24 h-24 bg-violet-600/20 text-violet-400 rounded-3xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-violet-600 group-hover:text-white transition-all duration-500">
                    <Upload className="w-12 h-12" />
                  </div>
                  <span className="text-2xl font-bold font-display text-slate-100 mb-2">Select Assets</span>
                  <span className="text-sm text-slate-500 text-center max-w-[200px]">Drop images, videos or documents here.</span>
                </label>
              </div>
            ) : (
              <div className="w-full flex flex-col h-full max-h-[60vh] animate-in slide-in-from-bottom-8 duration-500">
                <textarea
                  className="flex-1 w-full glass rounded-3xl p-6 text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 border-white/5 resize-none mb-6 shadow-inner"
                  placeholder="Paste text or links here..."
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                />
                <button
                  onClick={handleTextSubmit}
                  disabled={!textInput.trim()}
                  className="btn-premium btn-primary w-full text-lg h-16 border border-white/10"
                >
                  <Type className="w-6 h-6 mr-3" />
                  Generate droplets
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center w-full min-h-0 z-10">

          {isProcessing ? (
            <div className="flex-1 flex flex-col items-center justify-center">
              <div className="relative">
                <div className="w-20 h-20 border-4 border-violet-500/20 rounded-full"></div>
                <div className="absolute inset-0 w-20 h-20 border-4 border-violet-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
              <h3 className="mt-8 text-2xl font-black font-display text-white">Encrypting</h3>
              <p className="text-slate-500 mt-2">March 2026 Core Optimization Active</p>
            </div>
          ) : (
            <>
              {/* File Info */}
              <div className="glass px-6 py-3 rounded-2xl flex items-center space-x-3 border-white/5 shadow-xl mb-6">
                <div className="p-2 bg-violet-600/10 rounded-lg">
                  <FileIcon className="w-4 h-4 text-violet-400" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold truncate max-w-[140px] text-slate-200">{file.name}</span>
                  <span className="text-[10px] text-slate-500">{(file.size / 1024).toFixed(0)} KB • Droplets ready</span>
                </div>
                <button onClick={() => { setFile(null); setQrFrames([]); setIsPlaying(false); }} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors ml-2">
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>

              {/* QR Stage */}
              <div className="flex-1 w-full flex items-center justify-center min-h-0 py-4 relative mb-6">

                {/* Visual Accent */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-[300px] h-[300px] bg-violet-600/5 blur-[80px] rounded-full"></div>
                </div>

                {mode === 'STANDARD' && frame1 && (
                  <div className="h-full aspect-square max-h-[350px] p-4 bg-white rounded-3xl shadow-[0_0_50px_rgba(139,92,246,0.3)] flex items-center justify-center relative animate-in scale-95 fade-in duration-500">
                    <QRDisplay value={frame1} className="w-full h-full" />
                    <div className={`absolute -bottom-3 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-xl text-[10px] font-black tracking-widest uppercase shadow-xl z-20 ${isHeader ? 'bg-violet-600 text-white' : 'bg-slate-900 text-slate-300 border border-white/10'}`}>
                      {isHeader ? 'Header Droplet' : `Seq #${currentFrameIndex}`}
                    </div>
                  </div>
                )}

                {mode === 'DUAL' && (
                  <div className="flex items-center justify-center gap-4 w-full h-full max-h-[250px] animate-in scale-95 fade-in duration-500">
                    <div className="relative flex-1 max-w-[45%] aspect-square bg-white rounded-2xl shadow-xl flex items-center justify-center p-2">
                      {frame1 && <QRDisplay value={frame1} className="w-full h-full" />}
                      <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-lg text-[8px] font-black bg-slate-900 text-white border border-white/10">
                        L-{currentFrameIndex}
                      </div>
                    </div>
                    <div className="relative flex-1 max-w-[45%] aspect-square bg-white rounded-2xl shadow-xl flex items-center justify-center p-2">
                      {frame2 ? <QRDisplay value={frame2} className="w-full h-full" /> : <div className="text-slate-200">END</div>}
                      <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-lg text-[8px] font-black bg-slate-900 text-white border border-white/10">
                        R-{currentFrameIndex + 1}
                      </div>
                    </div>
                  </div>
                )}

                {mode === 'COLOR' && (
                  <div className="h-full aspect-square max-h-[350px] bg-white rounded-3xl shadow-2xl relative overflow-hidden animate-in scale-95 fade-in duration-500">
                    <div className="relative w-full h-full p-4 flex items-center justify-center">
                      {frame1 && <div className="absolute inset-0 p-4 mix-blend-multiply flex items-center justify-center"><QRDisplay value={frame1} fgColor="#00FFFF" bgColor="transparent" className="w-full h-full" /></div>}
                      {frame2 && <div className="absolute inset-0 p-4 mix-blend-multiply flex items-center justify-center"><QRDisplay value={frame2} fgColor="#FF00FF" bgColor="transparent" className="w-full h-full" /></div>}
                      {frame3 && <div className="absolute inset-0 p-4 mix-blend-multiply flex items-center justify-center"><QRDisplay value={frame3} fgColor="#FFFF00" bgColor="transparent" className="w-full h-full" /></div>}
                    </div>
                  </div>
                )}
              </div>

              {/* Controls */}
              {/* Slim Video-style Controls */}
              <div className="w-full max-w-md shrink-0 bg-white/5 border border-white/5 rounded-3xl p-4 backdrop-blur-md mb-6 shadow-xl space-y-4">

                {/* Progress Bar */}
                <div className="flex items-center gap-3 px-2">
                  <span className="text-[9px] font-black font-mono text-slate-500 w-6 text-right">{currentFrameIndex}</span>
                  <div className="flex-1 h-1 bg-slate-800 rounded-full relative overflow-hidden group/progress">
                    <input
                      type="range"
                      min="0"
                      max={qrFrames.length - 1}
                      value={currentFrameIndex}
                      onChange={(e) => { setIsPlaying(false); setCurrentFrameIndex(parseInt(e.target.value)); }}
                      className="absolute inset-0 w-full h-full opacity-0 z-20 cursor-pointer"
                    />
                    <div
                      className="absolute top-0 left-0 h-full bg-violet-500 transition-all duration-100"
                      style={{ width: `${(currentFrameIndex / (qrFrames.length - 1)) * 100}%` }}
                    ></div>
                  </div>
                  <span className="text-[9px] font-black font-mono text-slate-500 w-6">{qrFrames.length - 1}</span>
                </div>

                {/* Main Transport */}
                <div className="flex items-center justify-between px-4">
                  <div className="w-10"></div> {/* Spacer for symmetry if needed, or put something else here */}

                  <div className="flex items-center gap-6">
                    <button onClick={handlePrevFrame} className="p-2 text-slate-400 hover:text-white transition-all active:scale-75">
                      <ChevronLeft className="w-5 h-5" />
                    </button>

                    <button
                      onClick={() => setIsPlaying(!isPlaying)}
                      className="w-12 h-12 flex items-center justify-center bg-white text-slate-900 rounded-full shadow-lg active:scale-90 transition-all"
                    >
                      {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                    </button>

                    <button onClick={handleNextFrame} className="p-2 text-slate-400 hover:text-white transition-all active:scale-75">
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>

                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    className={`p-2 rounded-lg transition-all ${showSettings ? 'bg-violet-600/20 text-violet-400' : 'text-slate-400 hover:text-white'}`}
                  >
                    <Settings className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Settings Modal (Centered Popup) */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 animate-in fade-in zoom-in-95 duration-300">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setShowSettings(false)}></div>
          <div className="relative w-full max-w-sm glass-card p-8 border-white/10 shadow-[0_0_100px_rgba(0,0,0,0.8)]">
            <div className="space-y-8">
              {/* Mode Selection */}
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 block">Density Mode</label>
                <div className="grid grid-cols-3 gap-2 p-1 bg-slate-900/50 rounded-2xl border border-white/5">
                  <button
                    onClick={() => setMode('STANDARD')}
                    className={`py-3 rounded-xl text-[10px] font-black tracking-widest uppercase transition-all ${mode === 'STANDARD' ? 'bg-violet-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    1X
                  </button>
                  <button
                    onClick={() => setMode('DUAL')}
                    className={`py-3 rounded-xl text-[10px] font-black tracking-widest uppercase transition-all ${mode === 'DUAL' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    2X
                  </button>
                  <button
                    onClick={() => setMode('COLOR')}
                    className={`py-3 rounded-xl text-[10px] font-black tracking-widest uppercase transition-all ${mode === 'COLOR' ? 'bg-cyan-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    3X
                  </button>
                </div>
              </div>

              {/* FPS Control */}
              <div>
                <div className="flex justify-between items-center mb-4">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Velocity</label>
                  <span className="text-xs font-mono text-violet-400 font-bold">{fps.toFixed(1)} FPS</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="0.5"
                  value={fps}
                  onChange={(e) => setFps(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500 mb-2"
                />
                <div className="flex justify-between text-[8px] text-slate-600 font-bold uppercase tracking-tighter">
                  <span>Slow</span>
                  <span>Turbo</span>
                </div>
              </div>


            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Sender;
