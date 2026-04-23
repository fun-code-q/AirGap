import base45 from 'base45';
import { FountainDroplet, FileHeader, SealPacket } from '../types';
import { crc32 } from './protocol';
import { EncryptionKey } from './crypto';

/**
 * LT fountain codec — rateless erasure coding
 *
 * Model:
 *   Sender splits the sealed payload into K fixed-size byte blocks (last block
 *   zero-padded). For each droplet, a seed is chosen and expanded via a
 *   deterministic PRNG into (1) a degree d from the Ideal Soliton distribution
 *   and (2) d distinct source-block indices. The droplet payload is the XOR of
 *   those source blocks.
 *
 *   The receiver collects droplets, reruns the same PRNG from the seed to
 *   recover the index set, and runs a peeling decoder: any droplet of degree
 *   1 reveals a source block, which is XORed out of every other pending
 *   droplet, potentially cascading to more degree-1 reveals.
 *
 *   Because the receiver can reconstruct an index set from a single 32-bit
 *   seed, droplets stay compact regardless of K.
 *
 * Why it matters:
 *   Plain sequential chunking stalls on any missed frame — the receiver must
 *   wait for the broadcast loop to come back around. With LT codes, ANY K·(1+ε)
 *   droplets reconstruct the file, so the receiver never sits idle waiting for
 *   a specific index.
 *
 * Limitations (intentional):
 *   We use the ideal soliton distribution. It is mathematically clean but has
 *   a higher reconstruction failure probability than robust soliton for small
 *   K. For our chunk counts (typically 20–2000), in practice we converge after
 *   receiving ~1.2K droplets, which is fine for a broadcast medium.
 */

// Default block size in bytes. One base45-encoded block lands around 220 chars,
// which keeps QR codes on the alphanumeric-mode sweet spot (version 10–15).
export const FOUNTAIN_BLOCK_SIZE = 140;

/* ─────────────── PRNG ─────────────── */

/**
 * Mulberry32 — fast, good enough for coding theory. Deterministic from a seed.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ideal Soliton cumulative distribution, returned as a Float64Array where
 * cdf[d] = P(degree ≤ d). Cached per K.
 */
const solitonCache = new Map<number, Float64Array>();
function idealSolitonCdf(k: number): Float64Array {
  const cached = solitonCache.get(k);
  if (cached) return cached;
  const cdf = new Float64Array(k + 1);
  cdf[1] = 1 / k;
  for (let d = 2; d <= k; d++) cdf[d] = cdf[d - 1] + 1 / (d * (d - 1));
  solitonCache.set(k, cdf);
  return cdf;
}

/**
 * Reconstruct the index set from a seed. Must be deterministic — both sender
 * and receiver call this to agree on which source blocks a droplet covers.
 */
export function indicesFromSeed(seed: number, k: number): number[] {
  const rng = makeRng(seed);
  const cdf = idealSolitonCdf(k);

  // Pick degree via inverse CDF
  const u = rng();
  let degree = k;
  for (let d = 1; d <= k; d++) {
    if (u <= (cdf[d] ?? 1)) { degree = d; break; }
  }

  // Pick `degree` distinct source indices
  const idx = new Set<number>();
  // Safety ceiling in case a pathological RNG streak fails to find enough uniques
  let guard = degree * 8 + 16;
  while (idx.size < degree && guard-- > 0) {
    idx.add(Math.floor(rng() * k));
  }
  return Array.from(idx).sort((a, b) => a - b);
}

/* ─────────────── Byte helpers ─────────────── */

function xorInto(dst: Uint8Array, src: Uint8Array): void {
  const n = Math.min(dst.length, src.length);
  for (let i = 0; i < n; i++) dst[i] ^= src[i] ?? 0;
}

/**
 * Split sealed bytes into K blocks of exactly `blockSize`. Last block is
 * zero-padded. Returns the blocks and the ORIGINAL (unpadded) byte length so
 * the decoder can strip the tail.
 */
export function splitIntoBlocks(
  bytes: Uint8Array,
  blockSize = FOUNTAIN_BLOCK_SIZE,
): { blocks: Uint8Array[]; k: number; L: number } {
  const L = bytes.length;
  const k = Math.max(1, Math.ceil(L / blockSize));
  const blocks: Uint8Array[] = new Array(k);
  for (let i = 0; i < k; i++) {
    const block = new Uint8Array(blockSize);
    const slice = bytes.subarray(i * blockSize, (i + 1) * blockSize);
    block.set(slice);
    blocks[i] = block;
  }
  return { blocks, k, L };
}

/* ─────────────── Sender ─────────────── */

/**
 * Decide how many droplets to emit. We over-provision modestly because the
 * display loop can repeat; the receiver only needs a sufficient set.
 *   emitted = K * oversampleFactor + constant
 * For a ~600-block (~84 KB sealed) transfer this yields ~780 droplets, which
 * at 10 FPS loops every 78s.
 */
export function computeDropletCount(k: number, oversampleFactor = 1.25, floor = 24): number {
  return Math.max(floor, Math.ceil(k * oversampleFactor) + 16);
}

/**
 * Build a full set of QR frame strings for fountain-mode transmission:
 *   [SEAL, HEADER, F-droplet×N]
 * This matches the shape returned by `generateQRData` so the Sender UI can
 * consume either interchangeably.
 */
export function generateFountainFrames(
  id: string,
  file: File,
  payload: string,
  checksum: number,
  seal: EncryptionKey,
  sealedBytesFromProcessFile?: Uint8Array,
): string[] {
  // Prefer the already-computed sealed bytes if provided; otherwise round-trip
  // the base45 payload. (`bytes` is returned from processFile() today.)
  const bytes =
    sealedBytesFromProcessFile ?? Uint8Array.from(base45.decode(payload));

  const { blocks, k, L } = splitIntoBlocks(bytes);
  const frames: string[] = [];

  // SEAL frame — same shape as the sequential path
  const sealPacket: SealPacket = { id, keyId: seal.keyId, material: seal.exportedKey };
  frames.push(`AGv2:S:${JSON.stringify(sealPacket)}`);

  // HEADER frame — totalChunks carries K so the receiver can pre-allocate
  const header: FileHeader = {
    id,
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    totalChunks: k,
    checksum,
  };
  frames.push(`AGv2:H:${JSON.stringify(header)}`);

  // Fountain droplets
  const dropletCount = computeDropletCount(k);
  // Derive seeds deterministically from the UUID so reruns are reproducible during testing.
  // A cheap hash of the id, mixed with the droplet index:
  let idHash = 0;
  for (let i = 0; i < id.length; i++) idHash = (idHash * 31 + id.charCodeAt(i)) | 0;

  for (let n = 0; n < dropletCount; n++) {
    const seed = (idHash ^ (n * 0x9E3779B1)) >>> 0;
    const indices = indicesFromSeed(seed, k);
    const data = new Uint8Array(FOUNTAIN_BLOCK_SIZE);
    for (const i of indices) {
      const block = blocks[i];
      if (block) xorInto(data, block);
    }
    const p = base45.encode(data);
    const droplet: FountainDroplet = {
      id,
      s: seed,
      k,
      b: FOUNTAIN_BLOCK_SIZE,
      L,
      p,
      c: crc32(p),
    };
    frames.push(`AGv2:F:${JSON.stringify(droplet)}`);
  }

  return frames;
}

/* ─────────────── Receiver ─────────────── */

interface Pending {
  indices: Set<number>;
  data: Uint8Array;
}

/**
 * Peeling decoder. `addDroplet` is O(d) per call in the common case; a
 * cascade triggered by a new reveal is O(pending·d) in the worst case but
 * fast in practice because we only loop when something changes.
 */
export class FountainDecoder {
  readonly k: number;
  readonly blockSize: number;
  readonly L: number;
  private known = new Map<number, Uint8Array>();
  private pending: Pending[] = [];
  private _receivedDroplets = 0;

  constructor(k: number, blockSize: number, L: number) {
    this.k = k;
    this.blockSize = blockSize;
    this.L = L;
  }

  get knownCount(): number { return this.known.size; }
  get receivedDroplets(): number { return this._receivedDroplets; }
  get progress(): number { return this.known.size / this.k; }
  isComplete(): boolean { return this.known.size === this.k; }

  /**
   * @returns true if this droplet taught us at least one new source block.
   */
  addDroplet(seed: number, dataIn: Uint8Array): boolean {
    this._receivedDroplets++;
    const indices = new Set(indicesFromSeed(seed, this.k));
    const data = new Uint8Array(dataIn); // defensive copy — we mutate during peeling

    // Peel already-known blocks out of the incoming droplet
    for (const i of Array.from(indices)) {
      const known = this.known.get(i);
      if (known) {
        xorInto(data, known);
        indices.delete(i);
      }
    }

    if (indices.size === 0) return false; // redundant
    if (indices.size === 1) {
      const idx = indices.values().next().value as number;
      if (!this.known.has(idx)) {
        this.known.set(idx, data);
        this.cascade();
        return true;
      }
      return false;
    }

    this.pending.push({ indices, data });
    return this.cascade();
  }

  /**
   * Iterate through pending droplets, peeling any newly-revealed source blocks
   * until no more progress can be made.
   */
  private cascade(): boolean {
    let anyChange = false;
    let changed = true;

    while (changed) {
      changed = false;
      for (let p = this.pending.length - 1; p >= 0; p--) {
        const entry = this.pending[p];
        if (!entry) continue;

        // Peel any indices that have since become known
        for (const i of Array.from(entry.indices)) {
          const known = this.known.get(i);
          if (known) {
            xorInto(entry.data, known);
            entry.indices.delete(i);
            changed = true;
          }
        }

        if (entry.indices.size === 0) {
          this.pending.splice(p, 1);
        } else if (entry.indices.size === 1) {
          const idx = entry.indices.values().next().value as number;
          if (!this.known.has(idx)) {
            this.known.set(idx, entry.data);
            anyChange = true;
          }
          this.pending.splice(p, 1);
          changed = true;
        }
      }
    }
    return anyChange;
  }

  /**
   * Concatenate known source blocks into a single Uint8Array of exactly `L`
   * bytes (trimming the zero-padding on the final block). Throws if incomplete.
   */
  reassemble(): Uint8Array {
    if (!this.isComplete()) {
      throw new Error(
        `FountainDecoder.reassemble: ${this.known.size}/${this.k} blocks known`,
      );
    }
    const out = new Uint8Array(this.L);
    for (let i = 0; i < this.k; i++) {
      const block = this.known.get(i);
      if (!block) throw new Error(`missing block ${i}`);
      const offset = i * this.blockSize;
      const remaining = this.L - offset;
      if (remaining <= 0) break;
      out.set(block.subarray(0, Math.min(this.blockSize, remaining)), offset);
    }
    return out;
  }
}
