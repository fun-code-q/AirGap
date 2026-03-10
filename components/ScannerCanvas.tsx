import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Cpu, Zap, Maximize } from 'lucide-react';

interface ScannerCanvasProps {
  onScan: (data: string) => void;
  onError: (error: string) => void;
  isActive: boolean;
}

const ScannerCanvas: React.FC<ScannerCanvasProps> = ({ onScan, onError, isActive }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const isProcessingRef = useRef(false);
  const [debugInfo, setDebugInfo] = useState<string>("Initializing...");

  useEffect(() => {
    workerRef.current = new Worker(new URL('../utils/scanner.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current.onmessage = (e) => {
      isProcessingRef.current = false;
      const { results, error } = e.data;
      if (error) {
        console.error("Worker error:", error);
      } else if (results && results.length > 0) {
        results.forEach((data: string) => onScan(data));
        setDebugInfo(`STREAM: ACTIVE [${results.length} BLOCKS]`);
      } else {
        setDebugInfo("STREAM: POLLING...");
      }
    };
    return () => { workerRef.current?.terminate(); };
  }, [onScan]);

  const tick = useCallback(() => {
    const video = videoRef.current;
    if (!video || !isActive) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA && !isProcessingRef.current) {
      const canvas = canvasRef.current;
      if (canvas) {
        const PROC_WIDTH = 800;
        const scale = PROC_WIDTH / video.videoWidth;
        const h = Math.floor(video.videoHeight * scale);
        canvas.width = PROC_WIDTH;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, PROC_WIDTH, h);
          const imageData = ctx.getImageData(0, 0, PROC_WIDTH, h);
          isProcessingRef.current = true;
          workerRef.current?.postMessage({ imageData, width: PROC_WIDTH, height: h, requestId: Date.now() }, [imageData.data.buffer]);
        }
      }
    }
    requestAnimationFrame(tick);
  }, [isActive, onScan]);

  useEffect(() => {
    if (!isActive) return;
    let stream: MediaStream | null = null;
    let isMounted = true;
    const startCamera = async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        if (!isMounted) { s.getTracks().forEach(track => track.stop()); return; }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute("playsinline", "true");
          await videoRef.current.play();
          requestAnimationFrame(tick);
        }
      } catch (err) { if (isMounted) onError("Camera access denied."); }
    };
    startCamera();
    return () => { isMounted = false; if (stream) stream.getTracks().forEach(track => track.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, onError, tick]);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover scale-105" muted playsInline />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover opacity-0 pointer-events-none" />

      {/* High-Tech HUD Overlay */}
      <div className="absolute inset-0 z-10 pointer-events-none">
        {/* Vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_40%,rgba(0,0,0,0.6)_100%)]"></div>

        {/* Corner HUD Elements */}
        <div className="absolute top-6 left-6 flex items-center space-x-3 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10">
          <Cpu className="w-3 h-3 text-cyan-400 animate-pulse" />
          <span className="text-[10px] font-black font-mono text-cyan-400 tracking-tighter">{debugInfo}</span>
        </div>

        <div className="absolute top-6 right-6 flex items-center space-x-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10">
          <Zap className="w-3 h-3 text-yellow-400" />
          <span className="text-[10px] font-black font-mono text-slate-300">TURBO ON</span>
        </div>

        {/* Framing Guides */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-72 h-72 relative">
            {/* Dynamic Corners */}
            <div className="absolute top-0 left-0 w-12 h-12 border-t-2 border-l-2 border-cyan-500/50 rounded-tl-3xl shadow-[-5px_-5px_15px_rgba(6,182,212,0.2)]"></div>
            <div className="absolute top-0 right-0 w-12 h-12 border-t-2 border-r-2 border-cyan-500/50 rounded-tr-3xl shadow-[5px_-5px_15px_rgba(6,182,212,0.2)]"></div>
            <div className="absolute bottom-0 left-0 w-12 h-12 border-b-2 border-l-2 border-cyan-500/50 rounded-bl-3xl shadow-[-5px_5px_15px_rgba(6,182,212,0.2)]"></div>
            <div className="absolute bottom-0 right-0 w-12 h-12 border-b-2 border-r-2 border-cyan-500/50 rounded-br-3xl shadow-[5px_5px_15px_rgba(6,182,212,0.2)]"></div>

            {/* Center Crosshair */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center opacity-20">
              <div className="absolute w-full h-[1px] bg-white"></div>
              <div className="absolute h-full w-[1px] bg-white"></div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default ScannerCanvas;
