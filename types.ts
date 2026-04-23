export enum TransferMode {
  IDLE = 'IDLE',
  SEND = 'SEND',
  RECEIVE = 'RECEIVE',
}

export interface FileHeader {
  id: string;           // UUID, ties all frames of one transfer together
  name: string;
  mimeType: string;
  size: number;
  totalChunks: number;
  checksum: number;     // CRC32 of the whole Base45 payload
}

export interface ChunkData {
  id: string;           // Matches FileHeader.id
  index: number;
  total: number;
  data: string;         // Base45 slice
  crc: number;          // CRC32 of `data` — verified on receive
}

export interface SealPacket {
  id: string;           // Matches FileHeader.id
  keyId: string;        // Short human-readable fingerprint (e.g. "A3X7")
  material: string;     // `keyId:ivB64:keyB64` — consumed by importEncryptionKey
}

export interface AckPacket {
  id: string;
  receivedIndices: number[];
  missingIndices: number[];
}

export interface NakPacket {
  id: string;
  requestedIndices: number[];
}

export interface SyncHello {
  id: string;
  version: string;
}

export interface FountainDroplet {
  id: string;           // Matches FileHeader.id
  s: number;            // PRNG seed — determines which source indices are XORed
  k: number;            // K: total source blocks
  b: number;            // Block size in bytes
  L: number;            // Unpadded sealed-bytes length (so receiver can strip trailing zeros)
  p: string;            // Base45-encoded XOR payload (b bytes)
  c: number;            // CRC32 of p
}

export type DecodedPacketType =
  | 'SEAL'
  | 'HEADER'
  | 'DATA'
  | 'FOUNTAIN'
  | 'ACK'
  | 'NAK'
  | 'HELLO'
  | 'UNKNOWN';

export interface DecodedPacket {
  type: DecodedPacketType;
  seal?: SealPacket;
  header?: FileHeader;
  chunk?: ChunkData;
  droplet?: FountainDroplet;
  ack?: AckPacket;
  nak?: NakPacket;
  hello?: SyncHello;
}

export interface TransferState {
  transferId: string | null;
  header: FileHeader | null;
  totalChunks: number | null;
  receivedChunks: Map<number, string>;
  sealMaterial: string | null;  // Key material from SEAL frame
  keyId: string | null;
  progress: number;
  isComplete: boolean;
  resultUrl: string | null;
  corruptChunkCount: number;    // How many chunks were rejected by CRC
}

export interface ProgressInfo {
  bytes: number;
  total: number;
  percentage: number;
  chunks: number;
  totalChunks: number;
  estimatedTimeRemaining: number | null;
  speed: number;
}
