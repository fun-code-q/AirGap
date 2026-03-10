import React from 'react';
import QRCode from 'react-qr-code';

interface QRDisplayProps {
  value: string;
  size?: number;
  fgColor?: string;
  bgColor?: string;
  className?: string;
}

const QRDisplay: React.FC<QRDisplayProps> = ({
  value,
  size = 256,
  fgColor = "#020617", // Deep Dark for contrast on white
  bgColor = "#FFFFFF",
  className = "bg-white p-6 rounded-3xl shadow-[0_0_40px_rgba(255,255,255,0.1)] border border-white/10"
}) => {
  return (
    <div className={`${className} flex items-center justify-center relative overflow-hidden group`}>
      {/* Decorative inner glow */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none"></div>

      <div className="relative z-10 p-2 bg-white rounded-xl">
        <QRCode
          size={size}
          style={{ height: "auto", maxWidth: "100%", width: "100%" }}
          value={value}
          viewBox={`0 0 256 256`}
          level="M" // Medium error correction = better resilience but still clear
          fgColor={fgColor}
          bgColor={bgColor}
        />
      </div>

      {/* Futuristic Corners */}
      <div className="absolute top-4 left-4 w-4 h-4 border-t-2 border-l-2 border-cyan-500/30 rounded-tl"></div>
      <div className="absolute top-4 right-4 w-4 h-4 border-t-2 border-r-2 border-cyan-500/30 rounded-tr"></div>
      <div className="absolute bottom-4 left-4 w-4 h-4 border-b-2 border-l-2 border-cyan-500/30 rounded-bl"></div>
      <div className="absolute bottom-4 right-4 w-4 h-4 border-b-2 border-r-2 border-cyan-500/30 rounded-br"></div>
    </div>
  );
};

export default QRDisplay;
