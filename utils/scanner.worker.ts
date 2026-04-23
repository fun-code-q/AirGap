/// <reference lib="webworker" />
import { readBarcodes, ReaderOptions } from 'zxing-wasm/reader';

/**
 * Scanner worker
 *
 * Two pipelines:
 *   1) Native BarcodeDetector + zxing-wasm fallback on the full image (STANDARD, DUAL modes).
 *   2) Color-channel demultiplex: split an incoming RGBA frame into three greyscale
 *      buffers (R, G, B), binarize each, and decode independently. This is what lets
 *      COLOR mode actually work: the sender composites CMY ink on white, so:
 *          R channel receives the Cyan   layer content
 *          G channel receives the Magenta layer content
 *          B channel receives the Yellow  layer content
 *      We dedupe by rawValue across all three channels, so the host sees one
 *      result per frame even if the same QR bled into multiple channels.
 *
 * The `colorMode` flag is sent by the host so we don't pay the 3× decode cost
 * when it isn't needed.
 */

interface ScanRequest {
  imageData: ImageData;
  width: number;
  height: number;
  requestId: number;
  colorMode?: boolean;
}

let barcodeDetector: { detect: (b: ImageBitmapSource) => Promise<Array<{ rawValue: string }>> } | null = null;

if ('BarcodeDetector' in self) {
  try {
    // @ts-expect-error - BarcodeDetector is still a draft API
    barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
  } catch {
    // Fall through to zxing-wasm
  }
}

const zxingOptions: ReaderOptions = {
  formats: ['QRCode'],
  tryHarder: true,
};

/**
 * Extract one color channel (0=R, 1=G, 2=B) into a new ImageData where R=G=B=channel,
 * with a per-pixel threshold so the QR shows up as solid black on a clean white field.
 * Using a global average as the threshold keeps it fast and avoids the cost of Otsu.
 */
function extractChannel(source: ImageData, channel: 0 | 1 | 2): ImageData {
  const { data, width, height } = source;
  const n = width * height;
  const out = new ImageData(width, height);
  const outData = out.data;

  // 1) Collect channel values + running mean
  const values = new Uint8ClampedArray(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = data[(i << 2) + channel] ?? 0;
    values[i] = v;
    sum += v;
  }
  const mean = sum / n;
  // Slight bias toward "dark = QR ink": anything below the mean is foreground.
  const threshold = mean * 0.85;

  // 2) Binarize
  for (let i = 0; i < n; i++) {
    const v = (values[i] ?? 0) < threshold ? 0 : 255;
    const o = i << 2;
    outData[o]     = v;
    outData[o + 1] = v;
    outData[o + 2] = v;
    outData[o + 3] = 255;
  }
  return out;
}

async function decodeOne(image: ImageData): Promise<string[]> {
  // Native first (hardware-accelerated on Android Chrome and macOS Safari)
  if (barcodeDetector) {
    try {
      const bc = await barcodeDetector.detect(image);
      if (bc.length > 0) return bc.map((b) => b.rawValue);
    } catch {
      // fall through
    }
  }
  const results = await readBarcodes(image, zxingOptions);
  return results.map((r) => r.text);
}

self.onmessage = async (e: MessageEvent<ScanRequest>) => {
  const { imageData, requestId, colorMode } = e.data;

  try {
    let values: string[];

    if (colorMode) {
      // Demultiplex three channels and decode each in parallel
      const channels: ImageData[] = [
        extractChannel(imageData, 0),
        extractChannel(imageData, 1),
        extractChannel(imageData, 2),
      ];
      const settled = await Promise.allSettled(channels.map(decodeOne));
      const unique = new Set<string>();
      for (const s of settled) {
        if (s.status === 'fulfilled') {
          for (const v of s.value) unique.add(v);
        }
      }
      values = Array.from(unique);
    } else {
      values = await decodeOne(imageData);
    }

    (self as unknown as Worker).postMessage({ requestId, results: values });
  } catch (err) {
    (self as unknown as Worker).postMessage({ requestId, error: String(err) });
  }
};
