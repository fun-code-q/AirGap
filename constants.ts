export const PROTOCOL_PREFIX = "AGv2";
export const PROTOCOL_SEPARATOR = ":";

export const CHUNK_SIZE = 900;
export const SCAN_INTERVAL_MS = 50;
export const DEFAULT_FRAME_DURATION = 100; // Even faster for 2026

export const CHUNK_CONFIG = {
    MAX_CHUNK_SIZE: 1024,
    SLIDING_WINDOW_SIZE: 12,
    RETRANSMISSION_DELAY: 1000,
};

export const TRANSFER_LIMITS = {
    MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
    SENDER_TIMEOUT: 15000,
};

export const SCANNER_CONFIG = {
    VIDEO_WIDTH: 1280,
    VIDEO_HEIGHT: 720,
    SCAN_WIDTH: 800,
    FRAME_DEBOUNCE: 50,
};

export const QR_CONFIG = {
    VERSION: 40,
    ERROR_CORRECTION: 'M',
};
