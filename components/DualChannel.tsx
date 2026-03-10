import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CheckCircle, AlertTriangle, RefreshCw, Zap, Cpu } from 'lucide-react';
import { MiniScanner } from './MiniScanner';
import QRDisplay from './QRDisplay';
import { parseQRData } from '../utils/protocol';
import {
    BidirectionalState,
    createSenderBidirectionalState,
    createReceiverBidirectionalState,
    processIncomingAck,
    updateAckData,
    checkConnectionTimeout
} from '../utils/bidirectional-channel';

interface DualChannelProps {
    isSender?: boolean;
    chunks?: string[];
    currentChunkIndex?: number;
    totalChunks?: number;
    receivedCount?: number;
    onChunkAcknowledged?: (index: number) => void;
    onTimeout?: () => void;
    enabled?: boolean;
}

export function DualChannel({
    isSender = true,
    chunks = [],
    currentChunkIndex = 0,
    totalChunks = 0,
    receivedCount = 0,
    onChunkAcknowledged,
    onTimeout,
    enabled = true,
}: DualChannelProps) {
    const [bidirectionalState] = useState<BidirectionalState>(
        isSender ? createSenderBidirectionalState() : createReceiverBidirectionalState()
    );

    const [ackQR, setAckQR] = useState<string>('');
    const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connected' | 'timeout'>('disconnected');
    const lastAckTimeRef = useRef<number>(Date.now());

    const handleAckScan = useCallback((rawData: string) => {
        if (!isSender || !enabled) return;
        const decoded = parseQRData(rawData);
        if (decoded.type !== 'ACK') return;

        const processed = processIncomingAck(bidirectionalState, decoded);
        if (processed.newlyAcked.length > 0) {
            setConnectionStatus('connected');
            lastAckTimeRef.current = Date.now();
            processed.newlyAcked.forEach(index => onChunkAcknowledged?.(index));
        }
    }, [isSender, enabled, bidirectionalState, onChunkAcknowledged]);

    useEffect(() => {
        if (isSender || !enabled || totalChunks === 0) return;
        const interval = window.setInterval(() => {
            const ackData = updateAckData(bidirectionalState, totalChunks);
            if (ackData) setAckQR(ackData);
        }, 500);
        return () => clearInterval(interval);
    }, [isSender, enabled, totalChunks, bidirectionalState]);

    useEffect(() => {
        if (!enabled) return;
        const timeoutCheck = setInterval(() => {
            if (checkConnectionTimeout(bidirectionalState)) {
                setConnectionStatus('timeout');
                onTimeout?.();
            }
        }, 1000);
        return () => clearInterval(timeoutCheck);
    }, [enabled, bidirectionalState, onTimeout]);

    const progress = totalChunks > 0
        ? (isSender ? (bidirectionalState.acknowledgedChunks.size / totalChunks) * 100 : (receivedCount / totalChunks) * 100)
        : 0;

    return (
        <div className="flex flex-col h-full glass-card border-white/5 overflow-hidden animate-in fade-in zoom-in-95 duration-700">
            {/* HUD Header */}
            <div className="flex items-center justify-between p-6 bg-white/5 border-b border-white/5 shrink-0 z-10">
                <div className="flex items-center space-x-3">
                    <div className="p-2 bg-cyan-600/20 rounded-xl">
                        {connectionStatus === 'connected' ? <Zap className="w-4 h-4 text-cyan-400 animate-pulse" /> : <RefreshCw className="w-4 h-4 text-slate-500 animate-spin" />}
                    </div>
                    <div>
                        <h3 className="text-xs font-black font-display text-white tracking-widest uppercase">
                            {isSender ? 'Sync Uplink' : 'Sync Downlink'}
                        </h3>
                        <p className={`text-[10px] font-bold ${connectionStatus === 'connected' ? 'text-cyan-400' : 'text-slate-500'}`}>
                            {connectionStatus.toUpperCase()}
                        </p>
                    </div>
                </div>
                <div className="flex items-center space-x-2 bg-black/40 px-3 py-1.5 rounded-full border border-white/5">
                    <Cpu className="w-3 h-3 text-violet-400" />
                    <span className="text-[10px] font-black font-mono text-slate-300">{(bidirectionalState.successRate * 100).toFixed(0)}% SIG</span>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-8 relative overflow-hidden">
                {/* Background Grid */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none"></div>

                {isSender ? (
                    <>
                        <div className="relative group perspective-1000">
                            <div className="absolute -inset-4 bg-cyan-500/20 blur-2xl rounded-full opacity-50 group-hover:opacity-100 transition-opacity"></div>
                            <QRDisplay value={chunks[currentChunkIndex] || ''} size={280} className="relative z-10" />
                        </div>

                        <div className="w-full max-w-[200px] aspect-video">
                            <MiniScanner onScan={handleAckScan} enabled={enabled} videoFacingMode="user" />
                        </div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] animate-pulse">Scanning Return Channel</p>
                    </>
                ) : (
                    <>
                        <div className="relative group">
                            <div className="absolute -inset-4 bg-violet-500/20 blur-2xl rounded-full opacity-50"></div>
                            <QRDisplay value={ackQR} size={240} className="relative z-10 p-4" />
                        </div>

                        <div className="w-full max-w-sm">
                            <div className="flex justify-between items-end mb-4">
                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Reconstruction Progress</span>
                                <span className="text-xl font-black font-display text-white">{progress.toFixed(0)}%</span>
                            </div>
                            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-cyan-600 to-violet-600 transition-all duration-500" style={{ width: `${progress}%` }}></div>
                            </div>
                        </div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Publishing Receipt State</p>
                    </>
                )}
            </div>

            {/* Metrics Footer */}
            <div className="grid grid-cols-3 divide-x divide-white/5 bg-white/5 border-t border-white/5 p-6 shrink-0 relative z-10">
                <div className="flex flex-col items-center">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Received</span>
                    <span className="text-lg font-black font-display text-white">{isSender ? bidirectionalState.acknowledgedChunks.size : receivedCount}</span>
                </div>
                <div className="flex flex-col items-center">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Total Chunks</span>
                    <span className="text-lg font-black font-display text-slate-400">{totalChunks}</span>
                </div>
                <div className="flex flex-col items-center">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">WASM Turbo</span>
                    <span className="text-xs font-black font-mono text-cyan-400">ACTIVE</span>
                </div>
            </div>
        </div>
    );
}

export default DualChannel;
