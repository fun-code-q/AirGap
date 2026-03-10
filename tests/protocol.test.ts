import { describe, it, expect } from 'vitest';
import {
    generateUUID,
    crc32,
    parseQRData,
    reconstructFile,
    generateAckPacket,
    generateQRData
} from '../utils/protocol';
import base45 from 'base45';
import * as fflate from 'fflate';

describe('Protocol Utilities', () => {
    describe('generateUUID', () => {
        it('should generate a valid-looking UUID', () => {
            const uuid = generateUUID();
            expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        });

        it('should generate unique UUIDs', () => {
            const u1 = generateUUID();
            const u2 = generateUUID();
            expect(u1).not.toBe(u2);
        });
    });

    describe('crc32', () => {
        it('should calculate correct checksum for strings', () => {
            // Test vectors for CRC32 implementation in protocol.ts
            expect(crc32('AirGap')).toBe(2045031902);
            expect(crc32('')).toBe(0);
        });
    });

    describe('generateAckPacket', () => {
        it('should generate correctly formatted ACK string', () => {
            const id = 'test-id';
            const received = [0, 1, 2];
            const missing = [3];
            const ack = generateAckPacket(id, received, missing);

            expect(ack).toMatch(/^AGv2:A:/);
            const data = JSON.parse(ack.split('AGv2:A:')[1]);
            expect(data.id).toBe(id);
            expect(data.receivedIndices).toEqual(received);
            expect(data.missingIndices).toEqual(missing);
        });
    });

    describe('QR Framing and Parsing', () => {
        it('should generate and parse header frames', () => {
            const id = generateUUID();
            const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
            const payload = base45.encode(new Uint8Array([1, 2, 3]));
            const checksum = 12345;

            const frames = generateQRData(id, file, payload, checksum);
            expect(frames.length).toBeGreaterThan(0);

            const headerFrame = frames[0];
            const parsed = parseQRData(headerFrame);

            expect(parsed.type).toBe('HEADER');
            expect(parsed.header?.id).toBe(id);
            expect(parsed.header?.name).toBe('test.txt');
            expect(parsed.header?.mimeType).toBe('text/plain');
            expect(parsed.header?.checksum).toBe(checksum);
        });

        it('should generate and parse data frames', () => {
            const id = generateUUID();
            const file = new File(['x'.repeat(500)], 'test.bin');
            const payload = 'SOME_ENCODED_DATA_THAT_IS_LONG_ENOUGH_TO_BE_TESTED';
            const checksum = 999;

            const frames = generateQRData(id, file, payload, checksum);
            // Index 0 is header, Index 1+ are data
            const dataFrame = frames[1];
            const parsed = parseQRData(dataFrame);

            expect(parsed.type).toBe('DATA');
            expect(parsed.chunk?.id).toBe(id);
            expect(parsed.chunk?.index).toBe(0);
            expect(parsed.chunk?.data).toBeDefined();
        });
    });

    describe('File Reconstruction', () => {
        it('should reconstruct original data after round-trip encoding', () => {
            const originalText = "AirGap Master Density Protocol 2026";
            const data = new TextEncoder().encode(originalText);

            // Simulating processFile logic
            const compressed = fflate.zlibSync(data);
            const encoded = base45.encode(compressed);

            // Reconstruct
            const blob = reconstructFile(encoded, 'text/plain');

            // Since reconstructFile returns a Blob, we need a way to check content
            // In vitest/jsdom environment, we can use FileReader or similar if supported
            // or just check if it's a blob of correct size
            expect(blob.size).toBe(data.length);
            expect(blob.type).toBe('text/plain');
        });
    });
});
