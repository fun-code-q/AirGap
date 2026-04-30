const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const toBytes = (input: Uint8Array | ArrayBuffer | ArrayLike<number> | string): Uint8Array => {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input === 'string') return new TextEncoder().encode(input);
  return Uint8Array.from(input);
};

export const encode = (input: Uint8Array | ArrayBuffer | ArrayLike<number> | string): string => {
  const bytes = toBytes(input);
  let output = '';

  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      let x = ((bytes[i] ?? 0) << 8) + (bytes[i + 1] ?? 0);
      const e = x % 45;
      x = Math.floor(x / 45);
      const d = x % 45;
      const c = Math.floor(x / 45);
      output += CHARSET[e] + CHARSET[d] + CHARSET[c];
    } else {
      let x = bytes[i] ?? 0;
      const d = x % 45;
      const c = Math.floor(x / 45);
      output += CHARSET[d] + CHARSET[c];
    }
  }

  return output;
};

export const decode = (input: string): Uint8Array => {
  const values = Array.from(input, (char) => {
    const index = CHARSET.indexOf(char);
    if (index === -1) throw new Error(`Invalid Base45 character: ${char}`);
    return index;
  });
  const bytes: number[] = [];

  for (let i = 0; i < values.length; i += 3) {
    const remaining = values.length - i;

    if (remaining >= 3) {
      const x = (values[i] ?? 0) + (values[i + 1] ?? 0) * 45 + (values[i + 2] ?? 0) * 45 * 45;
      if (x > 0xffff) throw new Error('Invalid Base45 triplet');
      bytes.push(x >> 8, x & 0xff);
    } else if (remaining === 2) {
      const x = (values[i] ?? 0) + (values[i + 1] ?? 0) * 45;
      if (x > 0xff) throw new Error('Invalid Base45 pair');
      bytes.push(x);
    } else {
      throw new Error('Invalid Base45 length');
    }
  }

  return new Uint8Array(bytes);
};

export default { encode, decode };
