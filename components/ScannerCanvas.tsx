import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Cpu, Zap } from 'lucide-react';

interface ScannerCanvasProps {
  onScan: (data: string) => void;
  onError: (error: string | null) => void;
  isActive: boolean;
  /** When true, the worker also demultiplexes R/G/B channels and can decode COLOR mode. */
  colorMode?: boolean;
}

const describeCameraError = (error: unknown): string => {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Camera permission denied. Allow camera access and try again.';
      case 'NotFoundError':
        return 'No camera was found on this device.';
      case 'NotReadableError':
        return 'Camera is already in use by another app or browser tab.';
      case 'OverconstrainedError':
        return 'Requested camera settings are not supported on this device.';
      case 'AbortError':
        return 'Camera startup was interrupted. Please retry.';
      default:
        break;
    }
  }

  return 'Could not start the camera.';
};

const ScannerCanvas: React.FC<ScannerCanvasProps> = ({ onScan, onError, isActive, colorMode = false }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);
  const [debugInfo, setDebugInfo] = useState<string>('Initializing...');

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    workerRef.current = new Worker(new URL('../utils/scanner.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current.onmessage = (e) => {
      isProcessingRef.current = false;
      const { results, error } = e.data;
      if (error) {
        console.error('Worker error:', error);
      } else if (results && results.length > 0) {
        results.forEach((data: string) => onScan(data));
        setDebugInfo(`STREAM: ACTIVE [${results.length} BLOCKS]`);
      } else {
        setDebugInfo('STREAM: POLLING...');
      }
    };
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [onScan]);

  const tick = useCallback(() => {
    const video = videoRef.current;
    if (!video || !isActive) {
      rafRef.current = null;
      return;
    }

    if (video.readyState === video.HAVE_ENOUGH_DATA && !isProcessingRef.current) {
      const canvas = canvasRef.current;
      if (canvas && video.videoWidth > 0 && video.videoHeight > 0) {
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
          workerRef.current?.postMessage(
            { imageData, width: PROC_WIDTH, height: h, requestId: Date.now(), colorMode },
            [imageData.data.buffer],
          );
        }
      }
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [isActive, colorMode]);

  useEffect(() => {
    if (!isActive) {
      stopCamera();
      return;
    }

    let isCancelled = false;

    const startCamera = async () => {
      try {
        if (!window.isSecureContext) {
          onError('Camera requires HTTPS (or localhost in dev).');
          setDebugInfo('CAMERA: INSECURE CONTEXT');
          return;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
          onError('This browser does not support camera capture.');
          setDebugInfo('CAMERA: API UNAVAILABLE');
          return;
        }

        onError(null);
        setDebugInfo('CAMERA: REQUESTING...');
        stopCamera();

        const candidateConstraints: MediaTrackConstraints[] = [
          { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          { facingMode: { ideal: 'environment' } },
          {},
        ];

        let stream: MediaStream | null = null;
        let lastError: unknown = null;

        for (const video of candidateConstraints) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
            break;
          } catch (error) {
            lastError = error;
            if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
              break;
            }
          }
        }

        if (!stream) {
          throw lastError ?? new Error('Unable to open camera');
        }

        if (isCancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        if (!videoRef.current) {
          stopCamera();
          return;
        }

        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.autoplay = true;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();

        if (!isCancelled) {
          setDebugInfo('STREAM: STARTED');
          rafRef.current = requestAnimationFrame(tick);
        }
      } catch (error) {
        if (!isCancelled) {
          onError(describeCameraError(error));
          setDebugInfo('CAMERA: ERROR');
        }
      }
    };

    void startCamera();

    return () => {
      isCancelled = true;
      stopCamera();
    };
  }, [isActive, onError, stopCamera, tick]);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover scale-105" muted playsInline autoPlay />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover opacity-0 pointer-events-none" />

      <div className="absolute inset-0 z-10 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_40%,rgba(0,0,0,0.6)_100%)]" />

        <div className="absolute top-6 left-6 flex items-center space-x-3 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10">
          <Cpu className="w-3 h-3 text-cyan-400 animate-pulse" />
          <span className="text-[10px] font-black font-mono text-cyan-400 tracking-tighter">{debugInfo}</span>
        </div>

        <div className="absolute top-6 right-6 flex items-center space-x-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10">
          <Zap className="w-3 h-3 text-yellow-400" />
          <span className="text-[10px] font-black font-mono text-slate-300">TURBO ON</span>
        </div>

        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-72 h-72 relative">
            <div className="absolute top-0 left-0 w-12 h-12 border-t-2 border-l-2 border-cyan-500/50 rounded-tl-3xl shadow-[-5px_-5px_15px_rgba(6,182,212,0.2)]" />
            <div className="absolute top-0 right-0 w-12 h-12 border-t-2 border-r-2 border-cyan-500/50 rounded-tr-3xl shadow-[5px_-5px_15px_rgba(6,182,212,0.2)]" />
            <div className="absolute bottom-0 left-0 w-12 h-12 border-b-2 border-l-2 border-cyan-500/50 rounded-bl-3xl shadow-[-5px_5px_15px_rgba(6,182,212,0.2)]" />
            <div className="absolute bottom-0 right-0 w-12 h-12 border-b-2 border-r-2 border-cyan-500/50 rounded-br-3xl shadow-[5px_5px_15px_rgba(6,182,212,0.2)]" />

            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center opacity-20">
              <div className="absolute w-full h-[1px] bg-white" />
              <div className="absolute h-full w-[1px] bg-white" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScannerCanvas;
