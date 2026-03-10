
import { readBarcodes, ReaderOptions } from 'zxing-wasm/reader';

let barcodeDetector: any = null;

// Initialize Native BarcodeDetector if available
if ('BarcodeDetector' in self) {
    try {
        // @ts-ignore
        barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
    } catch (e) {
        console.warn("Native BarcodeDetector initialization failed, falling back to WASM");
    }
}

self.onmessage = async (e: MessageEvent) => {
    const { imageData, width, height, requestId } = e.data;

    try {
        // Phase 1: Try Native API (Hardware Accelerated)
        if (barcodeDetector) {
            const barcodes = await barcodeDetector.detect(imageData);
            if (barcodes.length > 0) {
                self.postMessage({
                    requestId,
                    results: barcodes.map((b: any) => b.rawValue)
                });
                return;
            }
        }

        // Phase 2: Fallback to zxing-wasm (Higher Success Rate)
        // We expect zxing-wasm to be initialized. 
        // In a worker, we might need a slightly different setup for the WASM binary path.
        const options: ReaderOptions = {
            formats: ['QRCode'],
            tryHarder: true,
        };

        const results = await readBarcodes(imageData, options);

        if (results.length > 0) {
            self.postMessage({
                requestId,
                results: results.map(r => r.text)
            });
        } else {
            self.postMessage({ requestId, results: [] });
        }
    } catch (err) {
        self.postMessage({ requestId, error: String(err) });
    }
};
