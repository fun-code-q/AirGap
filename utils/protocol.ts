import base45 from './base45';
import * as fflate from 'fflate';
import CRC32 from 'crc-32';
import {
  FileHeader,
  ChunkData,
  DecodedPacket,
  AckPacket,
  SealPacket,
} from '../types';
import {
  generateEncryptionKey,
  importEncryptionKey,
  encryptData,
  decryptData,
  EncryptionKey,
} from './crypto';

/**
 * AirGap v2 - Core Wire Protocol
 *
 * Pipeline (sender):  file bytes → zlib → AES-256-GCM → Base45 → QR frames
 * Pipeline (receiver): scan frames → Base45 → AES-256-GCM → zlib → file bytes
 *
 * Frame types on the wire:
 *   AGv2:S:<json>   Seal     — AES key material (must arrive before H/D)
 *   AGv2:H:<json>   Header   — file metadata + total chunks + whole-payload CRC32
 *   AGv2:D:<json>   Data     — one chunk, with its own CRC32
 *   AGv2:A:<json>   Ack      — receiver → sender progress report (bidirectional)
 *   AGv2:N:<json>   Nak      — receiver → sender "retransmit these indices"
 *   AGv2:L:<json>   Hello    — discovery handshake
 */

export const generateUUID = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Deterministic fallback for very old environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/**
 * CRC32 over a string (signed int from the crc-32 package, normalized to unsigned u32).
 * Used for both the whole-payload checksum (header) and per-chunk integrity.
 */
export const crc32 = (data: string): number => {
  return CRC32.str(data) >>> 0;
};

export interface ProcessedFile {
  payload: string;      // Base45-encoded, compressed, encrypted
  bytes: Uint8Array;    // Same content as `payload`, pre-Base45 — used by fountain mode
  checksum: number;     // CRC32 of the whole Base45 payload
  seal: EncryptionKey;  // Key + IV (shared out-of-band via SEAL frame)
}

export const toExactArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/**
 * Compress → encrypt → Base45 encode.
 * The returned `seal` MUST be transmitted before any DATA frames.
 */
export const processFile = async (file: File): Promise<ProcessedFile> => {
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // 1. Compress first — encryption output is uncompressible, so order matters.
  const compressed = fflate.zlibSync(uint8Array, { level: 6 });

  // 2. Generate a fresh AES-256-GCM key + IV for this transfer.
  const seal = await generateEncryptionKey();

  // 3. Encrypt the compressed bytes.
  const encrypted = await encryptData(compressed, seal.key, seal.iv);

  // GCM authentication tag is appended to the ciphertext so decrypt() can verify.
  const sealedBytes = new Uint8Array(encrypted.data.length + encrypted.tag.length);
  sealedBytes.set(encrypted.data, 0);
  sealedBytes.set(encrypted.tag, encrypted.data.length);

  // 4. Base45 encode — QR alphanumeric mode gets ~97% efficiency on Base45.
  const encoded = base45.encode(sealedBytes);

  return {
    payload: encoded,
    bytes: sealedBytes,
    checksum: crc32(encoded),
    seal,
  };
};

export const generateQRData = (
  id: string,
  file: File,
  payload: string,
  checksum: number,
  seal: EncryptionKey,
): string[] => {
  const CHUNK_SIZE = 220; // Tuned for QR version 10-15 at error-correction level M
  const totalChunks = Math.ceil(payload.length / CHUNK_SIZE);
  const frames: string[] = [];

  // 1. SEAL frame — must be the first frame the receiver sees
  const sealPacket: SealPacket = {
    id,
    keyId: seal.keyId,
    material: seal.exportedKey, // `keyId:ivB64:keyB64` already packed by crypto.ts
  };
  frames.push(`AGv2:S:${JSON.stringify(sealPacket)}`);

  // 2. HEADER frame — file metadata + whole-payload CRC
  const header: FileHeader = {
    id,
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    totalChunks,
    checksum,
  };
  frames.push(`AGv2:H:${JSON.stringify(header)}`);

  // 3. DATA frames, each with its own CRC
  for (let i = 0; i < totalChunks; i++) {
    const chunk = payload.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const chunkData: ChunkData = {
      id,
      index: i,
      total: totalChunks,
      data: chunk,
      crc: crc32(chunk),
    };
    frames.push(`AGv2:D:${JSON.stringify(chunkData)}`);
  }

  return frames;
};

export const generateAckPacket = (
  id: string,
  received: number[],
  missing: number[],
): string => {
  const ack: AckPacket = { id, receivedIndices: received, missingIndices: missing };
  return `AGv2:A:${JSON.stringify(ack)}`;
};

export const parseQRData = (rawData: string): DecodedPacket => {
  if (!rawData.startsWith('AGv2:')) return { type: 'UNKNOWN' };

  try {
    const typeMarker = rawData.charAt(5);
    const jsonPart = rawData.slice(7);

    switch (typeMarker) {
      case 'S':
        return { type: 'SEAL', seal: JSON.parse(jsonPart) };
      case 'H':
        return { type: 'HEADER', header: JSON.parse(jsonPart) };
      case 'D':
        return { type: 'DATA', chunk: JSON.parse(jsonPart) };
      case 'F':
        return { type: 'FOUNTAIN', droplet: JSON.parse(jsonPart) };
      case 'A':
        return { type: 'ACK', ack: JSON.parse(jsonPart) };
      case 'N':
        return { type: 'NAK', nak: JSON.parse(jsonPart) };
      case 'L':
        return { type: 'HELLO', hello: JSON.parse(jsonPart) };
      default:
        return { type: 'UNKNOWN' };
    }
  } catch (e) {
    console.error('Parse failed', e);
    return { type: 'UNKNOWN' };
  }
};

/**
 * Base45 decode → AES-GCM decrypt → zlib inflate → Blob.
 * The `sealMaterial` string is the one sent in the SEAL frame.
 */
export const reconstructFile = async (
  combinedData: string,
  mimeType: string,
  sealMaterial: string,
): Promise<Blob> => {
  // 1. Base45 decode → sealed bytes (ciphertext || tag)
  const sealedBytes = base45.decode(combinedData);

  // 2. Split tag off the end (AES-GCM tag is always 128 bits = 16 bytes)
  const TAG_LEN = 16;
  if (sealedBytes.length < TAG_LEN) {
    throw new Error('Sealed payload shorter than GCM tag length');
  }
  const cipherBytes = sealedBytes.slice(0, sealedBytes.length - TAG_LEN);
  const tagBytes = sealedBytes.slice(sealedBytes.length - TAG_LEN);

  // 3. Import key from seal material, decrypt
  const { key, iv } = await importEncryptionKey(sealMaterial);
  const compressed = await decryptData(cipherBytes, tagBytes, key, iv);

  // 4. Inflate
  const plaintextBytes = fflate.unzlibSync(compressed);

  return new Blob([toExactArrayBuffer(plaintextBytes)], { type: mimeType });
};

/**
 * Verify a DATA chunk's integrity. Used by the receiver to drop corrupt frames
 * before they poison the reassembly.
 */
export const verifyChunkChecksum = (data: string, expected: number): boolean => {
  return crc32(data) === (expected >>> 0);
};

/**
 * Verify the reassembled payload against the header CRC.
 */
export const verifyPayloadChecksum = (payload: string, expected: number): boolean => {
  return crc32(payload) === (expected >>> 0);
};
