/**
 * AirGap v2 - Cryptographic Utilities
 * Uses Web Crypto API for AES-256-GCM encryption
 */

export interface EncryptionKey {
    key: CryptoKey;
    keyId: string;
    iv: Uint8Array;
    exportedKey: string; // Base64 encoded for QR display
}

export interface EncryptedChunk {
    data: Uint8Array;
    iv: Uint8Array;
    tag: Uint8Array;
}

/**
 * Generate a new AES-256-GCM encryption key
 */
export async function generateEncryptionKey(): Promise<EncryptionKey> {
    const key = await crypto.subtle.generateKey(
        {
            name: 'AES-GCM',
            length: 256,
        },
        true,
        ['encrypt', 'decrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const keyId = generateKeyId();

    // Export key for display as QR
    const exportedKey = await crypto.subtle.exportKey('raw', key);
    const exportedKeyBase64 = uint8ArrayToBase64(new Uint8Array(exportedKey));

    return {
        key,
        keyId,
        iv,
        exportedKey: `${keyId}:${uint8ArrayToBase64(iv)}:${exportedKeyBase64}`,
    };
}

/**
 * Import encryption key from base64 string (received via QR)
 */
export async function importEncryptionKey(keyString: string): Promise<{
    key: CryptoKey;
    keyId: string;
    iv: Uint8Array;
}> {
    const parts = keyString.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid key format');
    }

    const [keyId, ivBase64, keyBase64] = parts;
    if (!keyId || !ivBase64 || !keyBase64) {
        throw new Error('Invalid key format');
    }
    const iv = base64ToUint8Array(ivBase64);
    const keyData = base64ToUint8Array(keyBase64);

    const key = await crypto.subtle.importKey(
        'raw',
        keyData.buffer.slice(keyData.byteOffset, keyData.byteOffset + keyData.byteLength) as ArrayBuffer,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );

    return { key, keyId, iv };
}

/**
 * Encrypt data using AES-256-GCM
 */
export async function encryptData(
    data: Uint8Array,
    key: CryptoKey,
    iv: Uint8Array
): Promise<EncryptedChunk> {
    const encrypted = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: new Uint8Array(iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer),
            tagLength: 128,
        },
        key,
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    );

    const encryptedArray = new Uint8Array(encrypted);
    // GCM appends the authentication tag to the ciphertext
    const tagLength = 16; // 128 bits
    const dataLength = encryptedArray.length - tagLength;

    return {
        data: encryptedArray.slice(0, dataLength),
        iv,
        tag: encryptedArray.slice(dataLength),
    };
}

/**
 * Decrypt data using AES-256-GCM
 */
export async function decryptData(
    encryptedData: Uint8Array,
    tag: Uint8Array,
    key: CryptoKey,
    iv: Uint8Array
): Promise<Uint8Array> {
    // Combine ciphertext and tag for GCM decryption
    const combined = new Uint8Array(encryptedData.length + tag.length);
    combined.set(encryptedData, 0);
    combined.set(tag, encryptedData.length);

    const decrypted = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: new Uint8Array(iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer),
            tagLength: 128,
        },
        key,
        combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength) as ArrayBuffer
    );

    return new Uint8Array(decrypted);
}

/**
 * Generate a short unique key ID
 */
function generateKeyId(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous chars
    let result = '';
    const randomValues = crypto.getRandomValues(new Uint8Array(4));
    for (let i = 0; i < 4; i++) {
        const charIndex = randomValues[i];
        if (charIndex !== undefined) {
            result += chars[charIndex % chars.length] ?? '';
        }
    }
    return result;
}

/**
 * Convert Uint8Array to base64 string (URL-safe)
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i];
        if (byte !== undefined) {
            binary += String.fromCharCode(byte);
        }
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Convert base64 string to Uint8Array (URL-safe)
 */
export function base64ToUint8Array(base64: string): Uint8Array {
    // Add padding if needed
    let padded = base64.replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4) {
        padded += '=';
    }

    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

const BASE45_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/**
 * Convert Uint8Array to Base45 string (RFC 9285)
 */
export function uint8ArrayToBase45(bytes: Uint8Array): string {
    let result = '';
    for (let i = 0; i < bytes.length; i += 2) {
        if (i + 1 < bytes.length) {
            const b1 = bytes[i] ?? 0;
            const b2 = bytes[i + 1] ?? 0;
            let n = (b1 << 8) + b2;
            const e = Math.floor(n / 2025);
            n %= 2025;
            const d = Math.floor(n / 45);
            const c = n % 45;
            result += BASE45_CHARSET[c] + BASE45_CHARSET[d] + BASE45_CHARSET[e];
        } else {
            const b1 = bytes[i] ?? 0;
            const d = Math.floor(b1 / 45);
            const c = b1 % 45;
            result += BASE45_CHARSET[c] + BASE45_CHARSET[d];
        }
    }
    return result;
}

/**
 * Convert Base45 string to Uint8Array (RFC 9285)
 */
export function base45ToUint8Array(base45: string): Uint8Array {
    const result: number[] = [];
    for (let i = 0; i < base45.length; i += 3) {
        if (i + 2 < base45.length) {
            const c = BASE45_CHARSET.indexOf(base45[i] ?? '');
            const d = BASE45_CHARSET.indexOf(base45[i + 1] ?? '');
            const e = BASE45_CHARSET.indexOf(base45[i + 2] ?? '');
            const n = c + d * 45 + e * 2025;
            result.push((n >> 8) & 0xff);
            result.push(n & 0xff);
        } else {
            const c = BASE45_CHARSET.indexOf(base45[i] ?? '');
            const d = BASE45_CHARSET.indexOf(base45[i + 1] ?? '');
            const n = c + d * 45;
            result.push(n & 0xff);
        }
    }
    return new Uint8Array(result);
}
