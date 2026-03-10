import React, { useRef, useEffect, useState } from 'react';

interface MiniScannerProps {
    onScan: (data: string) => void;
    enabled?: boolean;
    videoFacingMode?: 'user' | 'environment';
}

export const MiniScanner: React.FC<MiniScannerProps> = ({ onScan, enabled = true, videoFacingMode = 'environment' }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const workerRef = useRef<Worker | null>(null);
    const isProcessingRef = useRef(false);

    useEffect(() => {
        workerRef.current = new Worker(new URL('../utils/scanner.worker.ts', import.meta.url), { type: 'module' });
        workerRef.current.onmessage = (e) => {
            isProcessingRef.current = false;
            const { results } = e.data;
            if (results && results.length > 0) {
                results.forEach((data: string) => onScan(data));
            }
        };
        return () => workerRef.current?.terminate();
    }, [onScan]);

    useEffect(() => {
        if (!enabled) return;
        let stream: MediaStream | null = null;
        const startCamera = async () => {
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: videoFacingMode, width: { ideal: 640 }, height: { ideal: 480 } }
                });
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play();
                    requestAnimationFrame(tick);
                }
            } catch (err) { console.error("MiniScanner camera error", err); }
        };
        startCamera();
        return () => { if (stream) stream.getTracks().forEach(track => track.stop()); };
    }, [enabled, videoFacingMode]);

    const tick = () => {
        const video = videoRef.current;
        if (!video || !enabled) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA && !isProcessingRef.current) {
            const canvas = canvasRef.current;
            if (canvas) {
                canvas.width = 400;
                canvas.height = 300;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                    ctx.drawImage(video, 0, 0, 400, 300);
                    const imageData = ctx.getImageData(0, 0, 400, 300);
                    isProcessingRef.current = true;
                    workerRef.current?.postMessage({ imageData, width: 400, height: 300, requestId: Date.now() }, [imageData.data.buffer]);
                }
            }
        }
        requestAnimationFrame(tick);
    };

    return (
        <div className="relative w-full h-full bg-black rounded-xl overflow-hidden border border-white/10 shadow-2xl">
            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
            <canvas ref={canvasRef} className="hidden" />
            <div className="absolute inset-0 border-2 border-cyan-500/20 rounded-xl pointer-events-none"></div>
        </div>
    );
};

export default MiniScanner;
