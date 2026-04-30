import { describe, expect, it } from 'vitest';
import base45 from '../utils/base45';

describe('base45', () => {
  it('encodes and decodes RFC-style byte pairs', () => {
    const bytes = new Uint8Array([0x41, 0x42]);
    const encoded = base45.encode(bytes);

    expect(encoded).toBe('BB8');
    expect(base45.decode(encoded)).toEqual(bytes);
  });

  it('round-trips arbitrary binary data without Buffer', () => {
    const bytes = new Uint8Array([0, 1, 2, 42, 127, 128, 255]);

    expect(base45.decode(base45.encode(bytes))).toEqual(bytes);
  });
});
