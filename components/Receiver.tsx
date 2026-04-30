import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ArrowLeft, CheckCircle, Download, FileAudio, FileImage, FileText, AlertCircle, Trash2, FileVideo, FileCode, QrCode, Copy, Check, FileSpreadsheet, FileBox, Zap, Shield, ShieldAlert, X, Palette, Loader2 } from 'lucide-react';
import ScannerCanvas from './ScannerCanvas';
import { parseQRData, reconstructFile, verifyChunkChecksum, verifyPayloadChecksum, crc32, toExactArrayBuffer } from '../utils/protocol';
import { FountainDecoder } from '../utils/fountain';
import { TransferState } from '../types';
import base45 from '../utils/base45';
import { importEncryptionKey, decryptData } from '../utils/crypto';
import * as fflate from 'fflate';
import DOMPurify from 'dompurify';

// pdfjs + mammoth are large and only needed when the incoming file's MIME type
// matches. Lazy-import them on demand so the main Receiver chunk doesn't pay
// the ~700 KB cold-start cost for every transfer.
type PdfJsModule = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJsModule> | null = null;
async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfModProxy, workerUrlMod] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.js?url'),
      ]);
      const mod = ((pdfModProxy as any).default || pdfModProxy) as PdfJsModule;
      if (typeof window !== 'undefined' && (mod as any).GlobalWorkerOptions) {
        (mod as any).GlobalWorkerOptions.workerSrc = (workerUrlMod as any).default;
      }
      return mod;
    })();
  }
  return pdfjsPromise;
}

type MammothModule = typeof import('mammoth');
let mammothPromise: Promise<MammothModule> | null = null;
async function ensureBrowserBuffer(): Promise<void> {
  const global = globalThis as typeof globalThis & { Buffer?: unknown };
  if (!global.Buffer) {
    const { Buffer } = await import('buffer');
    global.Buffer = Buffer;
  }
}

async function loadMammoth(): Promise<MammothModule> {
  if (!mammothPromise) {
    mammothPromise = (async () => {
      await ensureBrowserBuffer();
      const m = await import('mammoth');
      return (m.default || m) as unknown as MammothModule;
    })();
  }
  return mammothPromise;
}

interface ReceiverProps {
  onBack: () => void;
}

const isPositiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && typeof value === 'number' && value > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isInteger(value) && typeof value === 'number' && value >= 0;

const Receiver: React.FC<ReceiverProps> = ({ onBack }) => {
  const [error, setError] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [viewMode, setViewMode] = useState<'PREVIEW' | 'CODE'>('PREVIEW');
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pdfPageNum, setPdfPageNum] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [colorScanMode, setColorScanMode] = useState(false);

  const [transfer, setTransfer] = useState<TransferState>({
    transferId: null,
    header: null,
    totalChunks: null,
    receivedChunks: new Map(),
    sealMaterial: null,
    keyId: null,
    progress: 0,
    isComplete: false,
    resultUrl: null,
    corruptChunkCount: 0,
  });

  // Guard against double-reassembly when setState callbacks run twice in StrictMode
  const reassemblyInFlightRef = useRef(false);
  // Fountain decoder lives outside React state because its internals are large
  // Uint8Arrays that we don't want to re-render on every droplet arrival.
  const fountainRef = useRef<FountainDecoder | null>(null);
  const seenFountainSeedsRef = useRef<Set<number>>(new Set());
  const [fountainProgress, setFountainProgress] = useState({ known: 0, received: 0, k: 0 });

  const reassemble = useCallback(async (
    chunks: Map<number, string>,
    totalChunks: number,
    mimeType: string,
    headerChecksum: number,
    sealMaterial: string,
  ) => {
    if (reassemblyInFlightRef.current) return;
    reassemblyInFlightRef.current = true;
    try {
      const sortedData = Array.from(chunks.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => v)
        .join('');

      if (!verifyPayloadChecksum(sortedData, headerChecksum)) {
        throw new Error('Payload CRC32 mismatch — transmission corrupted');
      }

      const blob = await reconstructFile(sortedData, mimeType, sealMaterial);
      const url = URL.createObjectURL(blob);
      setResultBlob(blob);
      setTransfer(prev => ({ ...prev, resultUrl: url, isComplete: true }));
    } catch (e) {
      console.error('Reconstruction failed', e);
      setError(e instanceof Error ? e.message : 'Reconstruction failed');
      reassemblyInFlightRef.current = false;
    }
  }, []);

  /**
   * Fountain reassembly path. Called when the decoder first reports complete.
   * Same end state as sequential — {resultUrl, isComplete} set — so the UI
   * rendering logic is unchanged.
   */
  const reassembleFountain = useCallback(async (
    decoder: FountainDecoder,
    mimeType: string,
    sealMaterial: string,
    headerChecksum: number,
  ) => {
    if (reassemblyInFlightRef.current) return;
    reassemblyInFlightRef.current = true;
    try {
      const sealedBytes = decoder.reassemble();

      if (!verifyPayloadChecksum(base45.encode(sealedBytes), headerChecksum)) {
        throw new Error('Fountain payload CRC32 mismatch - transmission corrupted');
      }

      // Split GCM tag from the end (128 bits = 16 bytes)
      const TAG_LEN = 16;
      if (sealedBytes.length < TAG_LEN) throw new Error('Sealed payload too small');
      const cipher = sealedBytes.slice(0, sealedBytes.length - TAG_LEN);
      const tag = sealedBytes.slice(sealedBytes.length - TAG_LEN);

      const { key, iv } = await importEncryptionKey(sealMaterial);
      const compressed = await decryptData(cipher, tag, key, iv);
      const plaintext = fflate.unzlibSync(compressed);

      const blob = new Blob([toExactArrayBuffer(plaintext)], { type: mimeType });
      const url = URL.createObjectURL(blob);
      setResultBlob(blob);
      setTransfer(prev => ({ ...prev, resultUrl: url, isComplete: true, progress: 1 }));
    } catch (e) {
      console.error('Fountain reconstruction failed', e);
      setError(e instanceof Error ? e.message : 'Fountain reconstruction failed');
      reassemblyInFlightRef.current = false;
    }
  }, []);

  const handleScan = useCallback((rawData: string) => {
    if (transfer.isComplete) return;
    const packet = parseQRData(rawData);
    if (packet.type === 'UNKNOWN') return;

    // Reject corrupt DATA / FOUNTAIN frames at the door
    if (packet.type === 'DATA' && packet.chunk) {
      const chunk = packet.chunk;
      if (
        !isNonNegativeInteger(chunk.index) ||
        !isPositiveInteger(chunk.total) ||
        chunk.index >= chunk.total ||
        typeof chunk.data !== 'string' ||
        !Number.isFinite(chunk.crc)
      ) {
        setTransfer(prev => ({ ...prev, corruptChunkCount: prev.corruptChunkCount + 1 }));
        return;
      }
      if (!verifyChunkChecksum(chunk.data, chunk.crc)) {
        setTransfer(prev => ({ ...prev, corruptChunkCount: prev.corruptChunkCount + 1 }));
        return;
      }
    }
    if (packet.type === 'FOUNTAIN' && packet.droplet) {
      const droplet = packet.droplet;
      if (
        !Number.isFinite(droplet.s) ||
        !isPositiveInteger(droplet.k) ||
        !isPositiveInteger(droplet.b) ||
        !isPositiveInteger(droplet.L) ||
        typeof droplet.p !== 'string' ||
        !Number.isFinite(droplet.c)
      ) {
        setTransfer(prev => ({ ...prev, corruptChunkCount: prev.corruptChunkCount + 1 }));
        return;
      }
      if (crc32(droplet.p) !== (droplet.c >>> 0)) {
        setTransfer(prev => ({ ...prev, corruptChunkCount: prev.corruptChunkCount + 1 }));
        return;
      }
    }

    if (packet.type === 'FOUNTAIN' && packet.droplet && seenFountainSeedsRef.current.has(packet.droplet.s)) {
      return;
    }

    setTransfer(prev => {
      const packetId =
        packet.seal?.id ?? packet.header?.id ?? packet.chunk?.id ?? packet.droplet?.id ?? null;
      if (!packetId) return prev;
      if (prev.transferId && prev.transferId !== packetId) return prev;

      let needsUpdate = false;
      if (!prev.transferId) needsUpdate = true;
      if (packet.type === 'SEAL' && packet.seal && !prev.sealMaterial) needsUpdate = true;
      if (packet.type === 'HEADER' && packet.header && !prev.header) needsUpdate = true;
      if (packet.type === 'DATA' && packet.chunk && !prev.receivedChunks.has(packet.chunk.index)) needsUpdate = true;
      if (packet.type === 'FOUNTAIN') needsUpdate = true;

      if (!needsUpdate) return prev;

      const nextState: TransferState = { ...prev };
      if (!nextState.transferId) nextState.transferId = packetId;

      if (packet.type === 'SEAL' && packet.seal && !nextState.sealMaterial) {
        nextState.sealMaterial = packet.seal.material;
        nextState.keyId = packet.seal.keyId;
      }

      if (packet.type === 'HEADER' && packet.header && !nextState.header) {
        if (
          !isPositiveInteger(packet.header.totalChunks) ||
          !isNonNegativeInteger(packet.header.size) ||
          !Number.isFinite(packet.header.checksum)
        ) {
          nextState.corruptChunkCount += 1;
          return nextState;
        }
        if (fountainRef.current && packet.header.totalChunks !== fountainRef.current.k) {
          nextState.corruptChunkCount += 1;
          return nextState;
        }
        nextState.header = packet.header;
        nextState.totalChunks = packet.header.totalChunks;
      }

      if (packet.type === 'DATA' && packet.chunk) {
        const expectedTotal = nextState.header?.totalChunks ?? nextState.totalChunks;
        if (
          (expectedTotal !== null && expectedTotal !== packet.chunk.total) ||
          packet.chunk.index >= packet.chunk.total
        ) {
          nextState.corruptChunkCount += 1;
          return nextState;
        }
        if (!nextState.receivedChunks.has(packet.chunk.index)) {
          if (nextState.totalChunks === null) nextState.totalChunks = packet.chunk.total;
          const newChunks = new Map(nextState.receivedChunks);
          newChunks.set(packet.chunk.index, packet.chunk.data);
          nextState.receivedChunks = newChunks;
        }
        if (nextState.totalChunks) {
          nextState.progress = nextState.receivedChunks.size / nextState.totalChunks;
        }
      }

      if (packet.type === 'FOUNTAIN' && packet.droplet) {
        const d = packet.droplet;
        if (
          d.b > 4096 ||
          (nextState.header && nextState.header.totalChunks !== d.k) ||
          (fountainRef.current && (
            fountainRef.current.k !== d.k ||
            fountainRef.current.blockSize !== d.b ||
            fountainRef.current.L !== d.L
          ))
        ) {
          nextState.corruptChunkCount += 1;
          return nextState;
        }

        let bytes: Uint8Array;
        try {
          bytes = Uint8Array.from(base45.decode(d.p));
        } catch {
          nextState.corruptChunkCount += 1;
          return nextState;
        }
        if (bytes.length !== d.b) {
          nextState.corruptChunkCount += 1;
          return nextState;
        }

        if (!fountainRef.current) {
          fountainRef.current = new FountainDecoder(d.k, d.b, d.L);
        }
        seenFountainSeedsRef.current.add(d.s);
        fountainRef.current.addDroplet(d.s, bytes);
        const dec = fountainRef.current;
        nextState.progress = dec.progress;
        setFountainProgress({ known: dec.knownCount, received: dec.receivedDroplets, k: dec.k });

      }

      const fountainReady =
        fountainRef.current?.isComplete() &&
        nextState.header &&
        nextState.sealMaterial &&
        !nextState.resultUrl;

      if (fountainReady && fountainRef.current && nextState.header && nextState.sealMaterial) {
        void reassembleFountain(
          fountainRef.current,
          nextState.header.mimeType,
          nextState.sealMaterial,
          nextState.header.checksum,
        );
      }

      // Sequential complete-check
      const sequentialReady =
        nextState.header &&
        nextState.totalChunks &&
        nextState.sealMaterial &&
        nextState.receivedChunks.size === nextState.totalChunks &&
        !nextState.resultUrl &&
        packet.type !== 'FOUNTAIN';

      if (sequentialReady && nextState.header && nextState.sealMaterial && nextState.totalChunks) {
        void reassemble(
          nextState.receivedChunks,
          nextState.totalChunks,
          nextState.header.mimeType,
          nextState.header.checksum,
          nextState.sealMaterial,
        );
      }

      return nextState;
    });
  }, [transfer.isComplete, reassemble, reassembleFountain]);

  const resetTransfer = () => {
    if (transfer.resultUrl) URL.revokeObjectURL(transfer.resultUrl);
    reassemblyInFlightRef.current = false;
    fountainRef.current = null;
    seenFountainSeedsRef.current.clear();
    setFountainProgress({ known: 0, received: 0, k: 0 });
    setResultBlob(null);
    setTransfer({
      transferId: null, header: null, totalChunks: null, receivedChunks: new Map(),
      sealMaterial: null, keyId: null,
      progress: 0, isComplete: false, resultUrl: null, corruptChunkCount: 0,
    });
    setError(null); setPreviewText(null); setRenderedHtml(null); setPreviewError(null); setPreviewLoading(false); setCopyFeedback(false);
    setViewMode('PREVIEW'); setPdfDoc(null); setPdfPageNum(1); setPdfTotalPages(0); setPdfLoading(false);
  };

  useEffect(() => {
    return () => {
      if (transfer.resultUrl) URL.revokeObjectURL(transfer.resultUrl);
    };
  }, [transfer.resultUrl]);

  const handleCopyCode = () => {
    if (previewText) {
      navigator.clipboard.writeText(previewText);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    }
  };

  const FileTypeIcon = useMemo(() => {
    if (!transfer.header) return FileText;
    const { mimeType, name } = transfer.header;
    if (mimeType.startsWith('image/')) return FileImage;
    if (mimeType.startsWith('audio/')) return FileAudio;
    if (mimeType.startsWith('video/')) return FileVideo;
    if (mimeType === 'application/pdf') return FileText;
    if (mimeType.includes('excel') || mimeType.includes('spreadsheet') || name.endsWith('.xlsx') || name.endsWith('.xls')) return FileSpreadsheet;
    if (mimeType.includes('json') || mimeType.includes('html') || mimeType.includes('xml') || mimeType.includes('javascript') || mimeType.includes('css')) return FileCode;
    return FileBox;
  }, [transfer.header]);

  const isCode = useMemo(() => {
    if (!transfer.header) return false;
    const { mimeType, name } = transfer.header;
    return (
      mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('html') ||
      mimeType.includes('javascript') || mimeType.includes('css') || mimeType.includes('x-python') ||
      mimeType.includes('x-java') || mimeType.includes('x-c') ||
      /\.(js|ts|tsx|jsx|py|java|c|cpp|cs|php|rb|go|rs|swift|kt|json|xml|html|css|md)$/i.test(name)
    );
  }, [transfer.header]);

  const isDocx = useMemo(() => {
    if (!transfer.header) return false;
    const { mimeType, name } = transfer.header;
    return (mimeType.includes('word') || mimeType.includes('officedocument.wordprocessingml') || name.endsWith('.docx'));
  }, [transfer.header]);

  const isPdf = useMemo(() => {
    if (!transfer.header) return false;
    return transfer.header.mimeType === 'application/pdf';
  }, [transfer.header]);

  const isHtml = useMemo(() => {
    if (!transfer.header) return false;
    return transfer.header.mimeType.includes('html') || transfer.header.name.endsWith('.html');
  }, [transfer.header]);

  const isPreviewableText = useMemo(() => {
    if (!transfer.header) return false;
    const { mimeType, name } = transfer.header;
    return (
      mimeType.startsWith('text/') ||
      mimeType.includes('json') ||
      mimeType.includes('xml') ||
      mimeType.includes('javascript') ||
      mimeType.includes('css') ||
      /\.(txt|md|json|xml|html|css|js|ts|tsx|jsx|py|java|c|cpp|h|cs|php|rb|go|rs|swift|kt|csv)$/i.test(name)
    );
  }, [transfer.header]);

  const formattedCode = useMemo(() => {
    if (!previewText) return null;
    if (transfer.header?.mimeType.includes('json') || transfer.header?.name.endsWith('.json')) {
      try { return JSON.stringify(JSON.parse(previewText), null, 2); } catch { return previewText; }
    }
    return previewText;
  }, [previewText, transfer.header]);

  useEffect(() => {
    if (!transfer.isComplete || !resultBlob || !transfer.header) return;

    let cancelled = false;
    setPreviewText(null);
    setRenderedHtml(null);
    setPdfDoc(null);
    setPdfPageNum(1);
    setPdfTotalPages(0);
    setPreviewError(null);

    const needsAsyncPreview = isPreviewableText || isDocx || isPdf;
    if (!needsAsyncPreview) {
      setPreviewLoading(false);
      setPdfLoading(false);
      return;
    }

    setPreviewLoading(true);
    setPdfLoading(isPdf);

    (async () => {
      try {
        if (isPreviewableText) {
          const text = await resultBlob.text();
          if (!cancelled) setPreviewText(text.slice(0, 100000));
          return;
        }

        if (isDocx) {
          const [mammoth, buffer] = await Promise.all([loadMammoth(), resultBlob.arrayBuffer()]);
          const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
          if (!cancelled) {
            setRenderedHtml(DOMPurify.sanitize(result.value || '<p>No document text found.</p>'));
          }
          return;
        }

        if (isPdf) {
          const [pdfjsLib, buffer] = await Promise.all([loadPdfJs(), resultBlob.arrayBuffer()]);
          const pdf = await (pdfjsLib as any).getDocument({ data: new Uint8Array(buffer) }).promise;
          if (!cancelled) {
            setPdfDoc(pdf);
            setPdfTotalPages(pdf.numPages);
          }
        }
      } catch (err) {
        console.error('Preview failed', err);
        if (!cancelled) {
          const message = isPdf ? 'Could not load PDF preview.' : isDocx ? 'Could not render document preview.' : 'Could not load text preview.';
          setPreviewError(message);
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
          setPdfLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [transfer.isComplete, resultBlob, transfer.header, isPreviewableText, isDocx, isPdf]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    setPdfLoading(true);

    pdfDoc.getPage(pdfPageNum).then((page: any) => {
      if (cancelled || !canvasRef.current) return null;
      const baseViewport = page.getViewport({ scale: 1 });
      const parentWidth = canvasRef.current.parentElement?.clientWidth ?? baseViewport.width;
      const scale = Math.min(1.5, Math.max(0.6, (parentWidth - 32) / baseViewport.width));
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current!;
      const context = canvas.getContext('2d');
      if (context) {
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        return page.render({ canvasContext: context, viewport: viewport }).promise;
      }
      return null;
    }).catch((err: unknown) => {
      console.error('PDF render failed', err);
      if (!cancelled) {
        setPreviewError('Could not render PDF page.');
      }
    }).finally(() => {
      if (!cancelled) setPdfLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pdfPageNum]);

  const previewState = (message: string, loading = false) => (
    <div className="min-h-full flex flex-col items-center justify-center gap-3 px-6 py-16 md:py-24 text-center text-slate-500">
      {loading ? (
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      ) : (
        <FileBox className="w-14 h-14 md:w-16 md:h-16 opacity-20" />
      )}
      <p className="text-[10px] md:text-xs uppercase tracking-widest">{message}</p>
    </div>
  );

  return (
    <div className="flex flex-col min-h-[100dvh] bg-[#020617] text-slate-100 overflow-hidden relative">
      {/* Background glow */}
      <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-cyan-600/10 blur-[100px] rounded-full pointer-events-none" />

      {/* Top bar — always floats over scanner or result */}
      <header
        className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 md:px-6"
        style={{ paddingTop: `max(env(safe-area-inset-top, 0px), 1rem)`, paddingBottom: '0.5rem' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label="Back"
            className="btn-icon bg-black/40 backdrop-blur-md border border-white/10 text-white"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl md:text-2xl font-black font-display tracking-tight text-white drop-shadow-lg">Capture</h1>
        </div>
        {transfer.transferId && (
          <button
            onClick={resetTransfer}
            aria-label={transfer.isComplete ? 'New scan' : 'Cancel'}
            className="btn-icon bg-red-500/20 backdrop-blur-md border border-red-500/20 text-red-300"
          >
            {transfer.isComplete ? <QrCode className="w-5 h-5" /> : <Trash2 className="w-5 h-5" />}
          </button>
        )}
      </header>

      <main className="flex-1 relative flex flex-col min-h-0">
        {transfer.isComplete ? (
          <div className="flex-1 flex flex-col w-full animate-in zoom-in-95 duration-300">
            <div
              className="flex-1 flex flex-col px-4 md:px-6 pt-20 md:pt-24 overflow-hidden"
              style={{ paddingBottom: `max(env(safe-area-inset-bottom, 0px), 1rem)` }}
            >
              <div className="glass-card flex-1 flex flex-col min-h-0 border-white/5 p-4 md:p-6">
                <div className="flex items-center justify-between mb-4 md:mb-6 shrink-0 gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="p-2.5 md:p-3 bg-cyan-600/20 rounded-2xl shrink-0">
                      <FileTypeIcon className="w-5 h-5 md:w-6 md:h-6 text-cyan-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-bold font-display text-white text-base md:text-lg truncate">{transfer.header?.name}</h3>
                      <p className="text-[10px] md:text-xs text-slate-500 uppercase tracking-widest">
                        {((transfer.header?.size || 0) / 1024).toFixed(1)} KB · Verified
                      </p>
                    </div>
                  </div>
                  <div className="w-10 h-10 md:w-12 md:h-12 bg-green-500/20 rounded-full flex items-center justify-center border border-green-500/20 shrink-0">
                    <CheckCircle className="w-5 h-5 md:w-6 md:h-6 text-green-500" />
                  </div>
                </div>

                <div className="flex-1 overflow-hidden relative bg-black/20 rounded-2xl border border-white/5 min-h-[30dvh]">
                  <div className="absolute inset-0 overflow-auto custom-scrollbar">
                    {transfer.header?.mimeType.startsWith('image/') ? (
                      <div className="p-4 flex items-center justify-center min-h-full">
                        <img src={transfer.resultUrl!} alt="Preview" className="max-w-full max-h-full rounded-xl shadow-2xl" />
                      </div>
                    ) : transfer.header?.mimeType.startsWith('video/') ? (
                      <video src={transfer.resultUrl!} controls className="w-full h-full object-contain" />
                    ) : transfer.header?.mimeType.startsWith('audio/') ? (
                      <div className="p-8 md:p-12 flex flex-col items-center justify-center gap-6 min-h-full">
                        <div className="w-20 h-20 md:w-24 md:h-24 bg-violet-600/20 rounded-full flex items-center justify-center animate-pulse">
                          <FileAudio className="w-10 h-10 md:w-12 md:h-12 text-violet-400" />
                        </div>
                        <audio src={transfer.resultUrl!} controls className="w-full max-w-md" />
                      </div>
                    ) : isPdf ? (
                      <div className="relative min-h-full p-4 flex justify-center">
                        {previewError && !pdfDoc ? (
                          previewState(previewError)
                        ) : (
                          <>
                            {(previewLoading || pdfLoading || !pdfDoc) && (
                              <div className="absolute inset-0 z-10 bg-slate-950/70 backdrop-blur-sm">
                                {previewState('Loading PDF preview', true)}
                              </div>
                            )}
                            <canvas ref={canvasRef} className="max-w-full mx-auto shadow-2xl bg-white rounded-lg" />
                          </>
                        )}
                      </div>
                    ) : isDocx ? (
                      previewError ? (
                        previewState(previewError)
                      ) : renderedHtml !== null ? (
                        <div
                          className="bg-white text-slate-900 p-6 md:p-8 min-h-full prose prose-sm max-w-none"
                          dangerouslySetInnerHTML={{ __html: renderedHtml }}
                        />
                      ) : (
                        previewState('Rendering document preview', true)
                      )
                    ) : isPreviewableText ? (
                      previewError ? (
                        previewState(previewError)
                      ) : previewText !== null ? (
                        <div className="p-4 md:p-6 font-mono text-xs md:text-sm text-cyan-100/80 leading-relaxed whitespace-pre-wrap break-all relative">
                          <div className="absolute top-3 right-3 flex gap-2 z-10">
                            <button onClick={handleCopyCode} aria-label="Copy" className="btn-icon glass">
                              {copyFeedback ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
                            </button>
                          </div>
                          <code>{isCode ? formattedCode : previewText}</code>
                        </div>
                      ) : (
                        previewState('Loading text preview', true)
                      )
                    ) : (
                      previewState('No visual preview available')
                    )}
                  </div>
                </div>

                <div className="mt-4 md:mt-6 shrink-0">
                  <a
                    href={transfer.resultUrl!}
                    download={transfer.header?.name}
                    className="btn-premium btn-primary w-full h-14 text-base border border-white/10"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    Save to device
                  </a>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col relative bg-black">
            <ScannerCanvas onScan={handleScan} onError={setError} isActive={!transfer.isComplete} colorMode={colorScanMode} />

            {/* Color-scan toggle — pill, floats top-right under the app header */}
            <button
              onClick={() => setColorScanMode((v) => !v)}
              aria-label={colorScanMode ? 'Disable color-scan mode' : 'Enable color-scan mode'}
              className={`absolute z-20 right-4 md:right-6 flex items-center gap-1.5 px-3 py-2 rounded-full backdrop-blur-md border transition-colors ${
                colorScanMode
                  ? 'bg-cyan-500/30 border-cyan-400/50 text-cyan-100'
                  : 'bg-black/40 border-white/10 text-slate-400'
              }`}
              style={{ top: `calc(max(env(safe-area-inset-top, 0px), 1rem) + 3.5rem)` }}
            >
              <Palette className="w-3.5 h-3.5" />
              <span className="text-[10px] font-black tracking-widest uppercase">
                {colorScanMode ? 'RGB On' : 'RGB'}
              </span>
            </button>

            {/* Scanner framing guide (only when idle) */}
            {!transfer.transferId && !error && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-8">
                <div
                  className="border border-white/20 rounded-3xl relative overflow-hidden"
                  style={{ width: 'min(75vw, 50dvh, 320px)', aspectRatio: '1 / 1' }}
                >
                  <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-cyan-500 to-transparent animate-scanner-line opacity-60" />
                </div>
                <div
                  className="absolute bg-black/50 backdrop-blur-md px-5 py-2.5 rounded-full border border-white/5"
                  style={{ bottom: `max(env(safe-area-inset-bottom, 0px), 2rem)` }}
                >
                  <span className="text-[11px] font-bold tracking-widest text-slate-300 uppercase">Awaiting transmission</span>
                </div>
              </div>
            )}

            {/* Live progress overlay */}
            {transfer.transferId && (
              <div
                className="absolute left-4 right-4 md:left-6 md:right-6 glass-card border-cyan-500/20 shadow-[0_0_50px_rgba(6,182,212,0.2)] animate-in slide-in-from-bottom-4 duration-300"
                style={{ bottom: `max(env(safe-area-inset-bottom, 0px), 1.5rem)` }}
              >
                <div className="flex items-center justify-between mb-3 gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 bg-cyan-600/20 rounded-xl flex items-center justify-center animate-pulse shrink-0">
                      <Zap className="w-5 h-5 text-cyan-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="font-bold text-white text-sm truncate">
                        {transfer.header?.name || (transfer.sealMaterial ? 'Awaiting header…' : 'Awaiting seal…')}
                      </h4>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest flex items-center gap-2 flex-wrap">
                        {transfer.keyId ? (
                          <span className="flex items-center gap-1 text-emerald-400">
                            <Shield className="w-2.5 h-2.5" /> {transfer.keyId}
                          </span>
                        ) : (
                          <span className="text-amber-400">Unsealed</span>
                        )}
                        {transfer.corruptChunkCount > 0 && (
                          <span className="flex items-center gap-1 text-amber-400" title="CRC-rejected frames">
                            <ShieldAlert className="w-2.5 h-2.5" /> {transfer.corruptChunkCount}
                          </span>
                        )}
                        {fountainProgress.k > 0 && (
                          <span className="text-cyan-400" title="Fountain: blocks known / droplets received">
                            ⚡ {fountainProgress.known}/{fountainProgress.k} · {fountainProgress.received}d
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-sm font-black font-mono text-cyan-400 tabular-nums">{(transfer.progress * 100).toFixed(0)}%</span>
                  </div>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-600 to-indigo-600 shadow-[0_0_10px_rgba(6,182,212,0.5)] transition-[width] duration-300"
                    style={{ width: `${transfer.progress * 100}%` }}
                  />
                </div>
              </div>
            )}

            {error && (
              <div
                className="absolute left-4 right-4 md:left-6 md:right-6 glass border-red-500/30 p-3 md:p-4 rounded-2xl flex items-center gap-3 animate-in slide-in-from-top-4 duration-300 z-20"
                style={{ top: `calc(max(env(safe-area-inset-top, 0px), 1rem) + 3.5rem)` }}
              >
                <AlertCircle className="w-5 h-5 md:w-6 md:h-6 text-red-500 shrink-0" />
                <span className="text-xs md:text-sm font-bold text-slate-200 flex-1 min-w-0 break-words">{error}</span>
                <button onClick={() => setError(null)} aria-label="Dismiss" className="btn-icon text-slate-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default Receiver;
