import {
    FileHeader,
    ChunkData,
    AckPacket,
    ProgressInfo,
} from '../types';
import {
    CHUNK_CONFIG,
    TRANSFER_LIMITS,
} from '../constants';
import { verifyChunkChecksum } from './protocol';

export interface SyncState {
    connected: boolean;
    handshakeComplete: boolean;
    direction: 'sender' | 'receiver';
    fileHeader: FileHeader | null;
    windowStart: number;
    windowEnd: number;
    windowSize: number;
    sentChunks: Set<number>;
    acknowledgedChunks: Set<number>;
    receivedChunks: Map<number, string>;
    pendingAcks: Set<number>;
    totalSent: number;
    totalReceived: number;
    totalAcked: number;
    successRate: number;
    lastActivityTime: number;
    retryCount: number;
}

export function createSenderState(): SyncState {
    return {
        connected: false,
        handshakeComplete: false,
        direction: 'sender',
        fileHeader: null,
        windowStart: 0,
        windowEnd: (CHUNK_CONFIG?.SLIDING_WINDOW_SIZE || 10) - 1,
        windowSize: CHUNK_CONFIG?.SLIDING_WINDOW_SIZE || 10,
        sentChunks: new Set(),
        acknowledgedChunks: new Set(),
        receivedChunks: new Map(),
        pendingAcks: new Set(),
        totalSent: 0,
        totalReceived: 0,
        totalAcked: 0,
        successRate: 1.0,
        lastActivityTime: Date.now(),
        retryCount: 0,
    };
}

export function createReceiverState(): SyncState {
    return {
        connected: false,
        handshakeComplete: false,
        direction: 'receiver',
        fileHeader: null,
        windowStart: 0,
        windowEnd: (CHUNK_CONFIG?.SLIDING_WINDOW_SIZE || 10) - 1,
        windowSize: CHUNK_CONFIG?.SLIDING_WINDOW_SIZE || 10,
        sentChunks: new Set(),
        acknowledgedChunks: new Set(),
        receivedChunks: new Map(),
        pendingAcks: new Set(),
        totalSent: 0,
        totalReceived: 0,
        totalAcked: 0,
        successRate: 1.0,
        lastActivityTime: Date.now(),
        retryCount: 0,
    };
}

export function getNextChunkToSend(state: SyncState): number | null {
    for (let i = state.windowStart; i <= state.windowEnd; i++) {
        if (!state.acknowledgedChunks.has(i)) return i;
    }
    return null;
}

export function handleAckPacket(state: SyncState, ack: AckPacket): {
    newlyAcked: number[];
    missing: number[];
} {
    const newlyAcked: number[] = [];
    for (const index of ack.receivedIndices) {
        if (!state.acknowledgedChunks.has(index)) {
            state.acknowledgedChunks.add(index);
            newlyAcked.push(index);
        }
    }
    state.lastActivityTime = Date.now();
    return { newlyAcked, missing: ack.missingIndices };
}

export function recordReceivedChunk(
    state: SyncState,
    chunk: ChunkData
): {
    isValid: boolean;
    isDuplicate: boolean;
} {
    if (state.receivedChunks.has(chunk.index)) {
        return { isValid: false, isDuplicate: true };
    }
    state.receivedChunks.set(chunk.index, chunk.data);
    state.totalReceived++;
    state.lastActivityTime = Date.now();
    return { isValid: true, isDuplicate: false };
}

export function calculateProgress(
    state: SyncState,
    totalChunks: number,
    header: FileHeader | null
): ProgressInfo {
    const chunks = state.direction === 'sender' ? state.acknowledgedChunks.size : state.receivedChunks.size;
    const bytes = header ? Math.floor((chunks / totalChunks) * header.size) : 0;
    return {
        bytes,
        total: header?.size || 0,
        percentage: totalChunks > 0 ? (chunks / totalChunks) * 100 : 0,
        chunks,
        totalChunks,
        estimatedTimeRemaining: null,
        speed: 0,
    };
}
