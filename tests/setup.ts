import { beforeAll, afterAll, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// Cleanup after each test
afterEach(() => {
    cleanup();
});

// Mock Web APIs not available in jsdom
beforeAll(() => {
    // Mock crypto.subtle
    Object.defineProperty(globalThis, 'crypto', {
        value: {
            subtle: {
                generateKey: vi.fn(),
                encrypt: vi.fn(),
                decrypt: vi.fn(),
                importKey: vi.fn(),
                exportKey: vi.fn(),
            },
            getRandomValues: (arr: Uint8Array) => {
                for (let i = 0; i < arr.length; i++) {
                    arr[i] = Math.floor(Math.random() * 256);
                }
                return arr;
            },
        },
    });
});
