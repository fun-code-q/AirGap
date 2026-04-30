import { describe, it, expect } from 'vitest';
import {
  FountainDecoder,
  generateFountainFrames,
  indicesFromSeed,
  splitIntoBlocks,
  makeRng,
  FOUNTAIN_BLOCK_SIZE,
  computeDropletCount,
} from '../utils/fountain';
import base45 from '../utils/base45';
import type { EncryptionKey } from '../utils/crypto';

const fakeSeal = (): EncryptionKey => ({
  key: {} as CryptoKey,
  keyId: 'TEST',
  iv: new Uint8Array(12),
  exportedKey: 'TEST:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
});

/**
 * Helper: encode `bytes` into droplets for K source blocks the same way the
 * sender does, then feed them to the decoder in a given order / with loss.
 */
function encodeDroplets(bytes: Uint8Array, seeds: number[]): { seed: number; data: Uint8Array }[] {
  const { blocks } = splitIntoBlocks(bytes);
  const k = blocks.length;
  return seeds.map((seed) => {
    const data = new Uint8Array(FOUNTAIN_BLOCK_SIZE);
    for (const i of indicesFromSeed(seed, k)) {
      const b = blocks[i]!;
      for (let j = 0; j < data.length; j++) data[j] ^= b[j] ?? 0;
    }
    return { seed, data };
  });
}

function randomBytes(n: number, seed = 42): Uint8Array {
  const rng = makeRng(seed);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(rng() * 256);
  return out;
}

/**
 * Try to decode `bytes` over K blocks using up to `maxDroplets` droplets.
 * Returns whether decode succeeded and how many droplets were consumed.
 */
function runDecode(bytes: Uint8Array, startSeed = 0, maxDroplets = 0): {
  ok: boolean;
  consumed: number;
  reassembled?: Uint8Array;
} {
  const { blocks, k, L } = splitIntoBlocks(bytes);
  const limit = maxDroplets || Math.max(64, k * 4);
  const dec = new FountainDecoder(k, FOUNTAIN_BLOCK_SIZE, L);

  for (let n = 0; n < limit; n++) {
    const seed = startSeed + n * 0x9E3779B1;
    const indices = indicesFromSeed(seed, k);
    const data = new Uint8Array(FOUNTAIN_BLOCK_SIZE);
    for (const i of indices) {
      const b = blocks[i]!;
      for (let j = 0; j < data.length; j++) data[j] ^= b[j] ?? 0;
    }
    dec.addDroplet(seed, data);
    if (dec.isComplete()) {
      return { ok: true, consumed: n + 1, reassembled: dec.reassemble() };
    }
  }
  return { ok: false, consumed: limit };
}

describe('fountain: PRNG', () => {
  it('mulberry32 is deterministic from seed', () => {
    const a = makeRng(12345);
    const b = makeRng(12345);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('produces values in [0, 1)', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('fountain: indicesFromSeed', () => {
  it('is deterministic — same seed => same indices', () => {
    const a = indicesFromSeed(0xDEADBEEF, 50);
    const b = indicesFromSeed(0xDEADBEEF, 50);
    expect(a).toEqual(b);
  });

  it('returns indices within [0, k)', () => {
    for (let s = 0; s < 50; s++) {
      const idx = indicesFromSeed(s * 17 + 3, 100);
      for (const i of idx) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(100);
      }
    }
  });

  it('returns unique indices per droplet (no duplicates)', () => {
    for (let s = 0; s < 30; s++) {
      const idx = indicesFromSeed(s * 101, 80);
      expect(new Set(idx).size).toBe(idx.length);
    }
  });

  it('k=1 always yields exactly [0]', () => {
    for (let s = 0; s < 10; s++) {
      expect(indicesFromSeed(s, 1)).toEqual([0]);
    }
  });

  it('negative seeds are reserved for systematic source blocks', () => {
    expect(indicesFromSeed(-1, 10)).toEqual([0]);
    expect(indicesFromSeed(-10, 10)).toEqual([9]);
    expect(indicesFromSeed(-11, 10)).toEqual([]);
  });
});

describe('fountain: splitIntoBlocks', () => {
  it('pads the last block with zeros', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { blocks, k, L } = splitIntoBlocks(bytes, 4);
    expect(k).toBe(1);
    expect(L).toBe(3);
    expect(blocks[0]).toEqual(new Uint8Array([1, 2, 3, 0]));
  });

  it('handles exact-multiple sizes', () => {
    const bytes = new Uint8Array(8).fill(9);
    const { blocks, k } = splitIntoBlocks(bytes, 4);
    expect(k).toBe(2);
    expect(blocks[0]).toEqual(new Uint8Array(4).fill(9));
    expect(blocks[1]).toEqual(new Uint8Array(4).fill(9));
  });

  it('produces k=1 for empty input (minimum guarantee)', () => {
    const { k, blocks } = splitIntoBlocks(new Uint8Array(0), 4);
    expect(k).toBe(1);
    expect(blocks.length).toBe(1);
  });
});

describe('fountain: FountainDecoder (happy paths)', () => {
  it('decodes k=1 (trivial case)', () => {
    const bytes = new Uint8Array([42]);
    const { ok, reassembled } = runDecode(bytes);
    expect(ok).toBe(true);
    expect(reassembled).toEqual(bytes);
  });

  it('decodes a small payload (k≈3)', () => {
    // 3 blocks of 140 bytes each
    const bytes = randomBytes(FOUNTAIN_BLOCK_SIZE * 3 - 10);
    const { ok, reassembled, consumed } = runDecode(bytes);
    expect(ok).toBe(true);
    expect(reassembled).toEqual(bytes);
    // Should converge well under the oversample bound
    expect(consumed).toBeLessThan(computeDropletCount(3));
  });

  it('decodes a medium payload (k=50)', () => {
    const bytes = randomBytes(FOUNTAIN_BLOCK_SIZE * 50 - 23);
    const { ok, reassembled, consumed } = runDecode(bytes);
    expect(ok).toBe(true);
    expect(reassembled).toEqual(bytes);
    expect(consumed).toBeLessThan(computeDropletCount(50) * 2);
  });

  it('decodes a large payload (k=200)', () => {
    const bytes = randomBytes(FOUNTAIN_BLOCK_SIZE * 200);
    const { ok, reassembled } = runDecode(bytes);
    expect(ok).toBe(true);
    expect(reassembled).toEqual(bytes);
  });

  it('generated frame sets are decodable after one complete sender loop', () => {
    const bytes = randomBytes(FOUNTAIN_BLOCK_SIZE * 50 - 17);
    const file = new File([new Uint8Array([1])], 'payload.bin');
    const frames = generateFountainFrames(
      '00000000-0000-4000-8000-000000000001',
      file,
      '',
      0,
      fakeSeal(),
      bytes,
    );
    const droplets = frames
      .filter((frame) => frame.startsWith('AGv2:F:'))
      .map((frame) => JSON.parse(frame.slice('AGv2:F:'.length)));

    expect(droplets.length).toBe(computeDropletCount(50));

    const first = droplets[0]!;
    const dec = new FountainDecoder(first.k, first.b, first.L);
    for (const droplet of droplets) {
      dec.addDroplet(droplet.s, Uint8Array.from(base45.decode(droplet.p)));
    }

    expect(dec.isComplete()).toBe(true);
    expect(dec.reassemble()).toEqual(bytes);
  });
});

describe('fountain: FountainDecoder (lossy)', () => {
  it('recovers from 30% packet loss at k=50', () => {
    const bytes = randomBytes(FOUNTAIN_BLOCK_SIZE * 50);
    const { blocks, k, L } = splitIntoBlocks(bytes);
    const dec = new FountainDecoder(k, FOUNTAIN_BLOCK_SIZE, L);

    const dropRng = makeRng(99);
    const maxAttempts = k * 6;
    let completed = false;
    for (let n = 0; n < maxAttempts && !completed; n++) {
      if (dropRng() < 0.3) continue; // drop ~30%
      const seed = 0xABCDEF ^ (n * 0x9E3779B1);
      const indices = indicesFromSeed(seed, k);
      const data = new Uint8Array(FOUNTAIN_BLOCK_SIZE);
      for (const i of indices) {
        const b = blocks[i]!;
        for (let j = 0; j < data.length; j++) data[j] ^= b[j] ?? 0;
      }
      dec.addDroplet(seed, data);
      if (dec.isComplete()) completed = true;
    }
    expect(completed).toBe(true);
    expect(dec.reassemble()).toEqual(bytes);
  });

  it('ignores redundant droplets without corrupting state', () => {
    const bytes = randomBytes(FOUNTAIN_BLOCK_SIZE * 10);
    const { blocks, k, L } = splitIntoBlocks(bytes);
    const dec = new FountainDecoder(k, FOUNTAIN_BLOCK_SIZE, L);

    const droplets = encodeDroplets(bytes, Array.from({ length: k * 3 }, (_, i) => i * 0x9E3779B1));
    for (const d of droplets) {
      dec.addDroplet(d.seed, d.data);
      // Feed each droplet twice — decoder must not break
      dec.addDroplet(d.seed, d.data);
    }
    expect(dec.isComplete()).toBe(true);
    expect(dec.reassemble()).toEqual(bytes);
    void blocks; // keep reference
  });

  it('decoder state is not polluted when droplet payload is defensively copied', () => {
    const bytes = randomBytes(FOUNTAIN_BLOCK_SIZE * 5);
    const { blocks, k, L } = splitIntoBlocks(bytes);
    const dec = new FountainDecoder(k, FOUNTAIN_BLOCK_SIZE, L);

    const droplets = encodeDroplets(bytes, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const d of droplets) {
      // Mutate the caller's buffer after handing it to the decoder; must not affect decode
      dec.addDroplet(d.seed, d.data);
      d.data.fill(0xFF);
    }
    if (dec.isComplete()) {
      expect(dec.reassemble()).toEqual(bytes);
    }
    // If not complete with 12 droplets for k=5, that's fine — the invariant we
    // care about is that feeding more won't produce a wrong result.
    for (let s = 100; s < 200 && !dec.isComplete(); s++) {
      const data = new Uint8Array(FOUNTAIN_BLOCK_SIZE);
      for (const i of indicesFromSeed(s, k)) {
        const b = blocks[i]!;
        for (let j = 0; j < data.length; j++) data[j] ^= b[j] ?? 0;
      }
      dec.addDroplet(s, data);
    }
    expect(dec.isComplete()).toBe(true);
    expect(dec.reassemble()).toEqual(bytes);
  });
});

describe('fountain: progress reporting', () => {
  it('progress monotonically increases to 1', () => {
    const bytes = randomBytes(FOUNTAIN_BLOCK_SIZE * 20);
    const { blocks, k, L } = splitIntoBlocks(bytes);
    const dec = new FountainDecoder(k, FOUNTAIN_BLOCK_SIZE, L);

    let last = 0;
    for (let s = 1; s < 200; s++) {
      const data = new Uint8Array(FOUNTAIN_BLOCK_SIZE);
      for (const i of indicesFromSeed(s, k)) {
        const b = blocks[i]!;
        for (let j = 0; j < data.length; j++) data[j] ^= b[j] ?? 0;
      }
      dec.addDroplet(s, data);
      expect(dec.progress).toBeGreaterThanOrEqual(last);
      last = dec.progress;
      if (dec.isComplete()) break;
    }
    expect(dec.isComplete()).toBe(true);
    expect(dec.progress).toBe(1);
  });
});
