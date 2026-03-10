
export enum TransferMode {
  IDLE = 'IDLE',
  SEND = 'SEND',
  RECEIVE = 'RECEIVE',
}

export interface FileHeader {
  id: string; // UUID
  name: string;
  mimeType: string;
  size: number;
  totalChunks: number;
  checksum: number; // Simple CRC or length check
}

export interface ChunkData {
  id: string; // Matches FileHeader id
  index: number;
  total: number;
  data: string; // Base45 chunk
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

export interface DecodedPacket {
  type: 'HEADER' | 'DATA' | 'ACK' | 'NAK' | 'HELLO' | 'UNKNOWN';
  header?: FileHeader;
  chunk?: ChunkData;
  ack?: AckPacket;
  nak?: NakPacket;
  hello?: SyncHello;
}

export interface TransferState {
  transferId: string | null;
  header: FileHeader | null;
  totalChunks: number | null;
  receivedChunks: Map<number, string>;
  progress: number;
  isComplete: boolean;
  resultUrl: string | null;
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
