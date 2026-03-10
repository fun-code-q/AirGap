import { describe, it, expect } from 'vitest';
import { uint8ArrayToBase64, base64ToUint8Array } from '../utils/crypto';

describe('uint8ArrayToBase64', () => {
    it('should encode Uint8Array to base64', () => {
        const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
        const encoded = uint8ArrayToBase64(data);

        expect(encoded).toBe('SGVsbG8');
    });

    it('should handle empty array', () => {
        const data = new Uint8Array([]);
        const encoded = uint8ArrayToBase64(data);

        expect(encoded).toBe('');
    });

    it('should be reversible', () => {
        const original = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
        const encoded = uint8ArrayToBase64(original);
        const decoded = base64ToUint8Array(encoded);

        expect(decoded).toEqual(original);
    });
});

describe('base64ToUint8Array', () => {
    it('should decode base64 to Uint8Array', () => {
        const encoded = 'SGVsbG8='; // "Hello" with padding
        const decoded = base64ToUint8Array(encoded);

        expect(decoded).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
    });

    it('should handle URL-safe base64', () => {
        const encoded = '_w'; // [255] URL-safe variant
        const decoded = base64ToUint8Array(encoded);

        expect(decoded).toEqual(new Uint8Array([255]));
    });
});
