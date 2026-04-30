import { describe, it, expect } from 'vitest';
import {
  generateUUID,
  crc32,
  parseQRData,
  generateAckPacket,
  generateQRData,
  verifyChunkChecksum,
  verifyPayloadChecksum,
  toExactArrayBuffer,
} from '../utils/protocol';
import base45 from '../utils/base45';
import type { EncryptionKey } from '../utils/crypto';

// Fake seal object — real crypto.subtle is mocked in setup.ts and not needed
// for framing / parsing tests. The fields must match the EncryptionKey shape.
const fakeSeal = (): EncryptionKey => ({
  key: {} as CryptoKey,
  keyId: 'TEST',
  iv: new Uint8Array(12),
  exportedKey: 'TEST:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
});

describe('Protocol Utilities', () => {
  describe('generateUUID', () => {
    it('produces a v4 UUID', () => {
      const uuid = generateUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('is unique across calls', () => {
      expect(generateUUID()).not.toBe(generateUUID());
    });
  });

  describe('crc32', () => {
    it('computes known test vectors', () => {
      // Standard CRC-32/IEEE on known strings
      expect(crc32('')).toBe(0);
      // "AirGap" — produced by the crc-32 package; the hand-rolled impl agrees.
      expect(crc32('AirGap')).toBe(2045031902);
    });

    it('is deterministic', () => {
      expect(crc32('hello world')).toBe(crc32('hello world'));
    });
  });

  describe('verifyChunkChecksum', () => {
    it('passes for correct CRC', () => {
      const data = 'HELLO';
      expect(verifyChunkChecksum(data, crc32(data))).toBe(true);
    });

    it('fails for wrong CRC', () => {
      expect(verifyChunkChecksum('HELLO', crc32('HELLO') ^ 1)).toBe(false);
    });

    it('normalizes signed CRC values (u32 safe)', () => {
      // If a signed i32 was accidentally passed, the >>> 0 coercion must match
      const data = 'X'.repeat(64);
      const signed = crc32(data) | 0;   // force signed view
      expect(verifyChunkChecksum(data, signed)).toBe(true);
    });
  });

  describe('verifyPayloadChecksum', () => {
    it('verifies whole-payload integrity', () => {
      const payload = 'some-reassembled-payload';
      expect(verifyPayloadChecksum(payload, crc32(payload))).toBe(true);
      expect(verifyPayloadChecksum(payload + 'X', crc32(payload))).toBe(false);
    });
  });

  describe('toExactArrayBuffer', () => {
    it('copies only the visible bytes from a Uint8Array view', () => {
      const source = new Uint8Array([9, 1, 2, 3, 9]);
      const view = source.subarray(1, 4);
      const exact = new Uint8Array(toExactArrayBuffer(view));

      expect(exact).toEqual(new Uint8Array([1, 2, 3]));
    });
  });

  describe('generateAckPacket', () => {
    it('formats ACK frames as AGv2:A:<json>', () => {
      const ack = generateAckPacket('test-id', [0, 1, 2], [3]);
      expect(ack).toMatch(/^AGv2:A:/);
      const body = JSON.parse(ack.slice('AGv2:A:'.length));
      expect(body).toEqual({ id: 'test-id', receivedIndices: [0, 1, 2], missingIndices: [3] });
    });
  });

  describe('generateQRData', () => {
    it('emits SEAL as frame #0 and HEADER as frame #1', () => {
      const id = generateUUID();
      const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
      const payload = base45.encode(new Uint8Array([1, 2, 3]));
      const frames = generateQRData(id, file, payload, 12345, fakeSeal());

      expect(frames.length).toBeGreaterThanOrEqual(3); // seal + header + ≥1 data

      const seal = parseQRData(frames[0]!);
      expect(seal.type).toBe('SEAL');
      expect(seal.seal?.id).toBe(id);
      expect(seal.seal?.keyId).toBe('TEST');

      const header = parseQRData(frames[1]!);
      expect(header.type).toBe('HEADER');
      expect(header.header?.id).toBe(id);
      expect(header.header?.name).toBe('test.txt');
      expect(header.header?.mimeType).toBe('text/plain');
      expect(header.header?.checksum).toBe(12345);
    });

    it('emits DATA frames after HEADER, each with a valid per-chunk CRC', () => {
      const id = generateUUID();
      const file = new File(['x'.repeat(500)], 'test.bin');
      const payload = 'X'.repeat(500);

      const frames = generateQRData(id, file, payload, 999, fakeSeal());

      // frames[0] = SEAL, frames[1] = HEADER, frames[2..] = DATA
      const dataFrame = parseQRData(frames[2]!);
      expect(dataFrame.type).toBe('DATA');
      expect(dataFrame.chunk?.id).toBe(id);
      expect(dataFrame.chunk?.index).toBe(0);
      expect(dataFrame.chunk?.data).toBeDefined();

      // Per-chunk CRC must round-trip
      expect(verifyChunkChecksum(dataFrame.chunk!.data, dataFrame.chunk!.crc)).toBe(true);
    });

    it('preserves chunk order — sequential indices 0..N-1', () => {
      const id = generateUUID();
      const file = new File(['x'], 'test.bin');
      const payload = 'Y'.repeat(1000);

      const frames = generateQRData(id, file, payload, 0, fakeSeal());
      const dataFrames = frames.slice(2).map((f) => parseQRData(f).chunk!);
      for (let i = 0; i < dataFrames.length; i++) {
        expect(dataFrames[i]!.index).toBe(i);
      }
    });
  });

  describe('parseQRData', () => {
    it('returns UNKNOWN for non-AGv2 data', () => {
      expect(parseQRData('https://example.com').type).toBe('UNKNOWN');
      expect(parseQRData('').type).toBe('UNKNOWN');
    });

    it('returns UNKNOWN for malformed JSON', () => {
      expect(parseQRData('AGv2:H:{not-json}').type).toBe('UNKNOWN');
    });

    it('recognizes all defined frame types', () => {
      expect(parseQRData('AGv2:S:{"id":"x","keyId":"A","material":"m"}').type).toBe('SEAL');
      expect(parseQRData('AGv2:F:{"id":"x","s":0,"k":1,"b":1,"L":1,"p":"","c":0}').type).toBe('FOUNTAIN');
      expect(parseQRData('AGv2:A:{"id":"x","receivedIndices":[],"missingIndices":[]}').type).toBe('ACK');
    });
  });
});
