import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ArrowLeft, CheckCircle, Download, FileAudio, FileImage, FileText, AlertCircle, Trash2, FileVideo, FileCode, QrCode, Copy, Check, FileSpreadsheet, FileBox, Eye, Code as CodeIcon, ChevronLeft, ChevronRight, Zap } from 'lucide-react';
import ScannerCanvas from './ScannerCanvas';
import { parseQRData, reconstructFile } from '../utils/protocol';
import { TransferState } from '../types';
import * as mammoth from 'mammoth';
import * as pdfjsLibProxy from 'pdfjs-dist';

const pdfjsLib = (pdfjsLibProxy as any).default || pdfjsLibProxy;
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://aistudiocdn.com/pdfjs-dist@^3.11.174/build/pdf.worker.min.js`;
}

interface ReceiverProps {
  onBack: () => void;
}

const Receiver: React.FC<ReceiverProps> = ({ onBack }) => {
  const [error, setError] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [viewMode, setViewMode] = useState<'PREVIEW' | 'CODE'>('PREVIEW');
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pdfPageNum, setPdfPageNum] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const [transfer, setTransfer] = useState<TransferState>({
    transferId: null,
    header: null,
    totalChunks: null,
    receivedChunks: new Map(),
    progress: 0,
    isComplete: false,
    resultUrl: null,
  });

  const handleScan = useCallback((rawData: string) => {
    if (transfer.isComplete) return;
    const packet = parseQRData(rawData);
    if (packet.type === 'UNKNOWN') return;

    setTransfer(prev => {
      const packetId = packet.header ? packet.header.id : (packet.chunk ? packet.chunk.id : null);
      if (!packetId) return prev;
      if (prev.transferId && prev.transferId !== packetId) return prev;

      let needsUpdate = false;
      if (!prev.transferId) needsUpdate = true;
      if (packet.type === 'HEADER' && packet.header && !prev.header) needsUpdate = true;
      if (packet.type === 'DATA' && packet.chunk && !prev.receivedChunks.has(packet.chunk.index)) needsUpdate = true;

      if (!needsUpdate) return prev;

      const nextState = { ...prev };
      if (!nextState.transferId) nextState.transferId = packetId;

      if (packet.type === 'HEADER' && packet.header && !nextState.header) {
        nextState.header = packet.header;
        nextState.totalChunks = packet.header.totalChunks;
      }

      if (packet.type === 'DATA' && packet.chunk) {
        if (!nextState.receivedChunks.has(packet.chunk.index)) {
          if (nextState.totalChunks === null) nextState.totalChunks = packet.chunk.total;
          const newChunks = new Map(nextState.receivedChunks);
          newChunks.set(packet.chunk.index, packet.chunk.data);
          nextState.receivedChunks = newChunks;
        }
      }

      if (nextState.totalChunks) {
        nextState.progress = nextState.receivedChunks.size / nextState.totalChunks;
      }

      if (nextState.header && nextState.totalChunks && nextState.receivedChunks.size === nextState.totalChunks && !nextState.resultUrl) {
        const sortedData = Array.from(nextState.receivedChunks.entries())
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(x => x[1]).join('');
        try {
          const blob = reconstructFile(sortedData, nextState.header.mimeType);
          nextState.resultUrl = URL.createObjectURL(blob);
          nextState.isComplete = true;
        } catch (e) {
          console.error("Reconstruction failed");
        }
      }
      return nextState;
    });
  }, [transfer.isComplete, transfer.resultUrl]);

  const resetTransfer = () => {
    if (transfer.resultUrl) URL.revokeObjectURL(transfer.resultUrl);
    setTransfer({
      transferId: null, header: null, totalChunks: null, receivedChunks: new Map(),
      progress: 0, isComplete: false, resultUrl: null,
    });
    setError(null); setPreviewText(null); setRenderedHtml(null); setCopyFeedback(false);
    setViewMode('PREVIEW'); setPdfDoc(null); setPdfPageNum(1); setPdfTotalPages(0);
  };

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

  const formattedCode = useMemo(() => {
    if (!previewText) return null;
    if (transfer.header?.mimeType.includes('json') || transfer.header?.name.endsWith('.json')) {
      try { return JSON.stringify(JSON.parse(previewText), null, 2); } catch { return previewText; }
    }
    return previewText;
  }, [previewText, transfer.header]);

  useEffect(() => {
    if (!transfer.isComplete || !transfer.resultUrl || !transfer.header) return;
    if ((transfer.header.mimeType.startsWith('text/') || transfer.header.mimeType.includes('json') || transfer.header.mimeType.includes('xml') || transfer.header.mimeType.includes('javascript') || transfer.header.mimeType.includes('css') || transfer.header.name.match(/\.(txt|md|json|xml|html|css|js|ts|tsx|jsx|py|java|c|cpp|h|cs|php|rb|go|rs|swift|kt|csv)$/i))) {
      fetch(transfer.resultUrl).then(res => res.text()).then(text => setPreviewText(text.slice(0, 100000))).catch(err => console.error("Text preview failed", err));
    }
    if (isDocx) {
      fetch(transfer.resultUrl).then(res => res.arrayBuffer()).then(buffer => mammoth.convertToHtml({ arrayBuffer: buffer })).then((result: any) => setRenderedHtml(result.value)).catch(err => console.error("Docx conversion failed", err));
    }
    if (isPdf) {
      setPdfLoading(true);
      const loadingTask = pdfjsLib.getDocument(transfer.resultUrl);
      loadingTask.promise.then((pdf: any) => { setPdfDoc(pdf); setPdfTotalPages(pdf.numPages); setPdfLoading(false); }, (reason: any) => { console.error(reason); setError("Error loading PDF"); setPdfLoading(false); });
    }
  }, [transfer.isComplete, transfer.resultUrl, transfer.header, isDocx, isPdf]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    pdfDoc.getPage(pdfPageNum).then((page: any) => {
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = canvasRef.current!;
      const context = canvas.getContext('2d');
      if (context) {
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        page.render({ canvasContext: context, viewport: viewport });
      }
    });
  }, [pdfDoc, pdfPageNum]);

  return (
    <div className="flex flex-col h-full bg-[#020617] text-slate-100 overflow-hidden relative">

      {/* Background Glow */}
      <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-cyan-600/10 blur-[100px] rounded-full pointer-events-none"></div>

      {/* Header */}
      <header className="p-6 flex items-center justify-between z-50 shrink-0 relative">
        <div className="flex items-center space-x-4">
          <button onClick={onBack} className="p-3 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 transition-all active:scale-95">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-2xl font-black font-display tracking-tight text-white">Capture</h1>
        </div>
        {transfer.transferId && (
          <button onClick={resetTransfer} className="p-3 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-2xl transition-all border border-red-500/10">
            {transfer.isComplete ? <QrCode className="w-6 h-6" /> : <Trash2 className="w-6 h-6" />}
          </button>
        )}
      </header>

      {/* Content Area */}
      <main className="flex-1 relative flex flex-col min-h-0">
        {transfer.isComplete ? (
          <div className="flex-1 flex flex-col w-full h-full animate-in zoom-in-95 duration-500">
            {/* Success Card */}
            <div className="flex-1 flex flex-col p-6 overflow-hidden">
              <div className="glass-card flex-1 flex flex-col min-h-0 border-white/5">
                <div className="flex items-center justify-between mb-6 shrink-0">
                  <div className="flex items-center space-x-4">
                    <div className="p-3 bg-cyan-600/20 rounded-2xl">
                      <FileTypeIcon className="w-6 h-6 text-cyan-400" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold font-display text-white text-lg truncate max-w-[180px]">{transfer.header?.name}</h3>
                      <p className="text-xs text-slate-500 uppercase tracking-widest">{((transfer.header?.size || 0) / 1024).toFixed(1)} KB • SUCCESS</p>
                    </div>
                  </div>
                  <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center border border-green-500/20">
                    <CheckCircle className="w-6 h-6 text-green-500" />
                  </div>
                </div>

                <div className="flex-1 overflow-hidden relative bg-black/20 rounded-2xl border border-white/5">
                  <div className="absolute inset-0 overflow-auto custom-scrollbar">
                    {transfer.header?.mimeType.startsWith('image/') ? (
                      <div className="p-4 flex items-center justify-center min-h-full"><img src={transfer.resultUrl!} alt="Preview" className="max-w-full rounded-xl shadow-2xl" /></div>
                    ) : transfer.header?.mimeType.startsWith('video/') ? (
                      <video src={transfer.resultUrl!} controls className="w-full" />
                    ) : transfer.header?.mimeType.startsWith('audio/') ? (
                      <div className="p-12 flex flex-col items-center justify-center space-y-6">
                        <div className="w-24 h-24 bg-violet-600/20 rounded-full flex items-center justify-center animate-pulse"><FileAudio className="w-12 h-12 text-violet-400" /></div>
                        <audio src={transfer.resultUrl!} controls className="w-full" />
                      </div>
                    ) : isPdf ? (
                      <div className="p-4"><canvas ref={canvasRef} className="max-w-full mx-auto shadow-2xl bg-white" /></div>
                    ) : isDocx ? (
                      <div className="bg-white text-slate-900 p-8 min-h-full prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: renderedHtml || '' }} />
                    ) : (isHtml || isCode || previewText) ? (
                      <div className="p-6 font-mono text-sm text-cyan-100/80 leading-relaxed whitespace-pre-wrap break-all relative">
                        <div className="absolute top-4 right-4 flex space-x-2">
                          <button onClick={handleCopyCode} className="p-2 glass rounded-lg hover:bg-white/10">{copyFeedback ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-slate-400" />}</button>
                        </div>
                        <code>{isCode ? formattedCode : previewText}</code>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-24 text-slate-600">
                        <FileBox className="w-16 h-16 mb-4 opacity-20" />
                        <p className="text-xs uppercase tracking-widest">No visual preview available</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-6 flex gap-4 shrink-0">
                  <a href={transfer.resultUrl!} download={transfer.header?.name} className="btn-premium btn-primary flex-1 h-14 border border-white/10">
                    <Download className="w-5 h-5 mr-3" />
                    Save to Device
                  </a>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col relative bg-black">
            <ScannerCanvas onScan={handleScan} onError={setError} isActive={!transfer.isComplete} />

            {/* Interactive Overlay */}
            {transfer.transferId && (
              <div className="absolute bottom-6 left-6 right-6 glass-card border-cyan-500/20 shadow-[0_0_50px_rgba(6,182,212,0.2)] animate-in slide-in-from-bottom-8 duration-500">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-cyan-600/20 rounded-xl flex items-center justify-center animate-pulse">
                      <Zap className="w-5 h-5 text-cyan-400" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-white text-sm truncate max-w-[140px]">{transfer.header?.name || 'Inbound Stream...'}</h4>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest">Collecting Droplets</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-black font-mono text-cyan-400">{(transfer.progress * 100).toFixed(0)}%</span>
                  </div>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-cyan-600 to-indigo-600 shadow-[0_0_10px_rgba(6,182,212,0.5)] transition-all duration-300" style={{ width: `${transfer.progress * 100}%` }}></div>
                </div>
              </div>
            )}

            {!transfer.transferId && !error && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-72 h-72 border border-white/20 rounded-3xl relative overflow-hidden">
                  <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-cyan-500 to-transparent animate-scanner-line opacity-50"></div>
                </div>
                <div className="absolute bottom-12 bg-black/40 backdrop-blur-md px-6 py-3 rounded-full border border-white/5">
                  <span className="text-xs font-bold tracking-widest text-slate-300 uppercase">Awaiting Transmission</span>
                </div>
              </div>
            )}

            {error && (
              <div className="absolute top-6 left-6 right-6 glass border-red-500/30 p-4 rounded-2xl flex items-center animate-in slide-in-from-top-8 duration-500">
                <AlertCircle className="w-6 h-6 text-red-500 mr-3 shrink-0" />
                <span className="text-sm font-bold text-slate-200">{error}</span>
                <button onClick={() => setError(null)} className="ml-auto p-2 hover:bg-white/10 rounded-xl">✕</button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Adding custom keyframes to index.css would be better but I'll add them to the parent div style for now if needed */}
      <style>{`
        @keyframes scanner-line {
          0% { top: 0%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        .animate-scanner-line {
          animation: scanner-line 3s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
      `}</style>
    </div>
  );
};

export default Receiver;
