import {
    FileHeader,
    ChunkData,
    AckPacket,
    DecodedPacket,
} from '../types';
import {
    CHUNK_CONFIG,
    TRANSFER_LIMITS,
} from '../constants';
import { generateAckPacket } from './protocol';

// ACK QR display interval (in ms) - how often receiver shows ACK
const ACK_DISPLAY_INTERVAL = 500; // Show new ACK every 500ms

export interface BidirectionalState {
    id: string;
    isSender: boolean;
    connected: boolean;
    lastContactTime: number;
    receivedChunks: Set<number>;
    acknowledgedChunks: Set<number>;
    missingChunks: Set<number>;
    successRate: number;
    roundTripTime: number;
    lastAckDisplayed: number;
    ackData: string | null;
}

export function createSenderBidirectionalState(): BidirectionalState {
    return {
        id: '',
        isSender: true,
        connected: false,
        lastContactTime: Date.now(),
        receivedChunks: new Set(),
        acknowledgedChunks: new Set(),
        missingChunks: new Set(),
        successRate: 1.0,
        roundTripTime: 0,
        lastAckDisplayed: 0,
        ackData: null,
    };
}

export function createReceiverBidirectionalState(): BidirectionalState {
    return {
        id: '',
        isSender: false,
        connected: false,
        lastContactTime: Date.now(),
        receivedChunks: new Set(),
        acknowledgedChunks: new Set(),
        missingChunks: new Set(),
        successRate: 1.0,
        roundTripTime: 0,
        lastAckDisplayed: 0,
        ackData: null,
    };
}

export function updateAckData(
    state: BidirectionalState,
    totalChunks: number
): string | null {
    const now = Date.now();
    if (now - state.lastAckDisplayed < ACK_DISPLAY_INTERVAL) {
        return state.ackData;
    }

    const received: number[] = [];
    const missing: number[] = [];

    for (let i = 0; i < totalChunks; i++) {
        if (state.receivedChunks.has(i)) {
            received.push(i);
        } else {
            missing.push(i);
        }
    }

    const ackString = generateAckPacket(state.id, received, missing);
    state.ackData = ackString;
    state.lastAckDisplayed = now;

    return ackString;
}

export function processIncomingAck(
    state: BidirectionalState,
    decoded: DecodedPacket
): {
    newlyAcked: number[];
    missing: number[];
    roundTripTime: number;
} {
    if (decoded.type !== 'ACK' || !decoded.ack) {
        return { newlyAcked: [], missing: [], roundTripTime: 0 };
    }

    const ack = decoded.ack;
    const newlyAcked: number[] = [];

    for (const index of ack.receivedIndices) {
        if (!state.acknowledgedChunks.has(index)) {
            state.acknowledgedChunks.add(index);
            newlyAcked.push(index);
        }
    }

    state.missingChunks = new Set(ack.missingIndices);
    const successCount = ack.receivedIndices.length;
    const totalExpected = Math.max(ack.receivedIndices.length + ack.missingIndices.length, 1);
    state.successRate = successCount / totalExpected;

    state.connected = true;
    state.lastContactTime = Date.now();

    return {
        newlyAcked,
        missing: ack.missingIndices,
        roundTripTime: state.roundTripTime,
    };
}

export function recordChunkReceived(
    state: BidirectionalState,
    chunkIndex: number
): boolean {
    if (state.receivedChunks.has(chunkIndex)) return false;
    state.receivedChunks.add(chunkIndex);
    state.lastContactTime = Date.now();
    return true;
}

export function checkConnectionTimeout(state: BidirectionalState): boolean {
    const elapsed = Date.now() - state.lastContactTime;
    return elapsed > (TRANSFER_LIMITS.SENDER_TIMEOUT || 10000);
}

export function getMissingChunks(state: BidirectionalState): number[] {
    return Array.from(state.missingChunks).sort((a, b) => a - b);
}
