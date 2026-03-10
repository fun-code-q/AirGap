import React, { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

interface BinaryQRProps {
    data: string;
    size?: number;
    className?: string;
}

/**
 * High-performance QR renderer using HTML5 Canvas.
 * Essential for 60 FPS transmission in March 2026 standards.
 */
export const BinaryQR: React.FC<BinaryQRProps> = ({ data, size = 300, className }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (canvasRef.current && data) {
            // Use the 'qrcode' library's canvas renderer directly for maximum speed
            QRCode.toCanvas(canvasRef.current, data, {
                width: size,
                margin: 2,
                color: {
                    dark: '#ffffff',
                    light: '#0f172a', // Match theme background
                },
                errorCorrectionLevel: 'L', // Low error correction for maximum data density
            }, (error) => {
                if (error) console.error('QR Render Error:', error);
            });
        }
    }, [data, size]);

    return (
        <div className={`flex items-center justify-center p-4 bg-slate-900 rounded-xl shadow-2xl ${className}`}>
            <canvas
                ref={canvasRef}
                style={{ width: `${size}px`, height: `${size}px` }}
                className="rounded-lg"
            />
        </div>
    );
};
