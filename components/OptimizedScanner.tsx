/**
 * AirGap v2 - Optimized QR Scanner
 * Uses BarcodeDetector API with jsQR fallback and smart frame selection
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import jsQR from 'jsqr';
import { SCANNER_CONFIG, QR_CONFIG } from '../constants';

export interface ScanResult {
    data: string;
    version: number;
    timestamp: number;
}

export interface ScannerOptions {
    onScan: (result: ScanResult) => void;
    onError?: (error: Error) => void;
    enabled?: boolean;
    videoFacingMode?: 'user' | 'environment';
}

interface BarcodeDetectorType {
    new(options?: { formats: string[] }): BarcodeDetectorType;
    detect(image: ImageBitmapSource): Promise<Array<{
        rawValue: string;
        format: string;
        boundingBox: DOMRectReadOnly;
    }>>;
}

// Check for BarcodeDetector support
const hasBarcodeDetector = 'BarcodeDetector' in window;
let BarcodeDetector: BarcodeDetectorType | null = null;

if (hasBarcodeDetector) {
    // @ts-expect-error - BarcodeDetector is not in TypeScript types yet
    BarcodeDetector = window.BarcodeDetector as BarcodeDetectorType;
}

export function useOptimizedScanner(options: ScannerOptions) {
    const {
        onScan,
        onError,
        enabled = true,
        videoFacingMode = 'environment',
    } = options;

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const detectorRef = useRef<BarcodeDetectorType | null>(null);
    const animationFrameRef = useRef<number>(0);
    const lastScanRef = useRef<string | null>(null);
    const lastScanTimeRef = useRef<number>(0);

    const [isScanning, setIsScanning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [supportsNativeDetector, setSupportsNativeDetector] = useState(hasBarcodeDetector);

    // Initialize camera
    const startCamera = useCallback(async () => {
        try {
            const constraints: MediaStreamConstraints = {
                video: {
                    facingMode: videoFacingMode,
                    width: { ideal: SCANNER_CONFIG.VIDEO_WIDTH },
                    height: { ideal: SCANNER_CONFIG.VIDEO_HEIGHT },
                },
                audio: false,
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            streamRef.current = stream;

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }

            // Initialize BarcodeDetector if available
            if (supportsNativeDetector) {
                // @ts-expect-error - BarcodeDetector is native API
                detectorRef.current = new window.BarcodeDetector({
                    formats: ['qr_code'],
                });
            }

            setIsScanning(true);
            setError(null);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to start camera';
            setError(errorMessage);
            onError?.(new Error(errorMessage));
        }
    }, [videoFacingMode, supportsNativeDetector, onError]);

    // Stop camera
    const stopCamera = useCallback(() => {
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
        }

        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }

        setIsScanning(false);
    }, []);

    // Scan frame using BarcodeDetector (native, fast)
    const scanWithBarcodeDetector = useCallback(async (video: HTMLVideoElement): Promise<ScanResult | null> => {
        if (!detectorRef.current) return null;

        try {
            const results = await detectorRef.current.detect(video);

            if (results.length > 0) {
                const qr = results[0];
                return {
                    data: qr.rawValue,
                    version: estimateQRVersion(qr.rawValue),
                    timestamp: Date.now(),
                };
            }
        } catch (err) {
            // Detector failed, will fall back to jsQR
            console.warn('BarcodeDetector error:', err);
        }

        return null;
    }, []);

    // Scan frame using jsQR (fallback)
    const scanWithJsQR = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number): ScanResult | null => {
        try {
            const imageData = ctx.getImageData(0, 0, width, height);
            const result = jsQR(imageData.data, width, height, {
                inversionAttempts: 'dontInvert',
            });

            if (result) {
                return {
                    data: result.data,
                    version: result.version || estimateQRVersion(result.data),
                    timestamp: Date.now(),
                };
            }
        } catch (err) {
            console.warn('jsQR error:', err);
        }

        return null;
    }, []);

    // Main scan loop
    const scan = useCallback(async () => {
        if (!videoRef.current || !canvasRef.current || !enabled) {
            return;
        }

        const video = videoRef.current;

        // Skip if video is not ready
        if (video.readyState !== video.HAVE_ENOUGH_DATA) {
            animationFrameRef.current = requestAnimationFrame(scan);
            return;
        }

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        if (!ctx) {
            animationFrameRef.current = requestAnimationFrame(scan);
            return;
        }

        // Downscale for performance
        const scale = SCANNER_CONFIG.SCAN_WIDTH / video.videoWidth;
        canvas.width = SCANNER_CONFIG.SCAN_WIDTH;
        canvas.height = video.videoHeight * scale;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        let result: ScanResult | null = null;

        // Try native BarcodeDetector first
        if (detectorRef.current) {
            result = await scanWithBarcodeDetector(video);
        }

        // Fallback to jsQR
        if (!result) {
            result = scanWithJsQR(ctx, canvas.width, canvas.height);
        }

        // Process result
        if (result) {
            const timeSinceLastScan = Date.now() - lastScanTimeRef.current;

            // Debounce: skip if same data within threshold
            if (result.data !== lastScanRef.current || timeSinceLastScan > SCANNER_CONFIG.FRAME_DEBOUNCE) {
                lastScanRef.current = result.data;
                lastScanTimeRef.current = Date.now();

                onScan(result);
            }
        }

        // Continue scanning
        animationFrameRef.current = requestAnimationFrame(scan);
    }, [enabled, onScan, scanWithBarcodeDetector, scanWithJsQR]);

    // Start/stop scanning based on enabled state
    useEffect(() => {
        if (enabled && !isScanning) {
            startCamera();
        } else if (!enabled && isScanning) {
            stopCamera();
        }

        return () => {
            stopCamera();
        };
    }, [enabled, isScanning, startCamera, stopCamera]);

    // Start scan loop when ready
    useEffect(() => {
        if (isScanning && videoRef.current) {
            animationFrameRef.current = requestAnimationFrame(scan);
        }

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [isScanning, scan]);

    return {
        videoRef,
        canvasRef,
        isScanning,
        error,
        supportsNativeDetector,
        startCamera,
        stopCamera,
    };
}

// Estimate QR version from data length
function estimateQRVersion(data: string): number {
    const length = data.length;

    if (length < 25) return 1;
    if (length < 47) return 2;
    if (length < 77) return 3;
    if (length < 114) return 4;
    if (length < 154) return 5;
    if (length < 182) return 6;
    if (length < 216) return 7;
    if (length < 254) return 8;
    if (length < 294) return 9;
    if (length < 354) return 20;
    if (length < 500) return 30;
    return 40; // Max version
}

export default useOptimizedScanner;
