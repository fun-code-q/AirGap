import { describe, it, expect, beforeEach } from 'vitest';
import { chunkFile, reconstructFile, detectMimeType } from '../utils/protocol';

describe('chunkFile', () => {
    it('should split data into correct number of chunks', () => {
        const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        const chunks = chunkFile(data, 3);

        expect(chunks.length).toBe(4);
        expect(chunks[0]).toEqual(new Uint8Array([1, 2, 3]));
        expect(chunks[1]).toEqual(new Uint8Array([4, 5, 6]));
        expect(chunks[2]).toEqual(new Uint8Array([7, 8, 9]));
        expect(chunks[3]).toEqual(new Uint8Array([10]));
    });

    it('should handle data smaller than chunk size', () => {
        const data = new Uint8Array([1, 2, 3]);
        const chunks = chunkFile(data, 10);

        expect(chunks.length).toBe(1);
        expect(chunks[0]).toEqual(data);
    });

    it('should handle empty data', () => {
        const data = new Uint8Array([]);
        const chunks = chunkFile(data, 10);

        expect(chunks.length).toBe(0);
    });
});

describe('reconstructFile', () => {
    it('should reconstruct original data from chunks', () => {
        const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        const chunks = chunkFile(data, 3);
        const chunkMap = new Map(chunks.map((chunk, i) => [i, chunk]));

        const reconstructed = reconstructFile(chunkMap, chunks.length);

        expect(reconstructed).toEqual(data);
    });

    it('should throw error for missing chunks', () => {
        const chunkMap = new Map<number, Uint8Array>();
        chunkMap.set(0, new Uint8Array([1, 2, 3]));
        // Missing chunk 1

        expect(() => reconstructFile(chunkMap, 2)).toThrow('Missing chunk 1');
    });
});

describe('detectMimeType', () => {
    it('should detect image types', () => {
        expect(detectMimeType('photo.jpg')).toBe('image/jpeg');
        expect(detectMimeType('image.png')).toBe('image/png');
        expect(detectMimeType('picture.webp')).toBe('image/webp');
    });

    it('should detect video types', () => {
        expect(detectMimeType('video.mp4')).toBe('video/mp4');
        expect(detectMimeType('movie.webm')).toBe('video/webm');
    });

    it('should detect document types', () => {
        expect(detectMimeType('doc.pdf')).toBe('application/pdf');
        expect(detectMimeType('file.txt')).toBe('text/plain');
        expect(detectMimeType('script.js')).toBe('application/javascript');
    });

    it('should return octet-stream for unknown types', () => {
        expect(detectMimeType('file.xyz')).toBe('application/octet-stream');
        expect(detectMimeType('noextension')).toBe('application/octet-stream');
    });
});
