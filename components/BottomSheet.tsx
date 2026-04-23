import React, { useEffect, useRef, useState, useCallback } from 'react';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** On desktop ≥768px, render as a centered modal instead of a sheet */
  desktopAsModal?: boolean;
}

/**
 * Native-feeling bottom sheet:
 *   • Mobile    — slides up from the bottom, drag the handle down to dismiss.
 *   • Desktop   — centered modal with backdrop (when desktopAsModal=true).
 * Locks body scroll while open, respects safe-area-inset-bottom, Escape to close.
 */
const BottomSheet: React.FC<BottomSheetProps> = ({
  open,
  onClose,
  title,
  children,
  desktopAsModal = true,
}) => {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Lock body scroll + Escape-to-close
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  // Reset drag offset when the sheet opens
  useEffect(() => {
    if (open) setDragY(0);
  }, [open]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startYRef.current = e.touches[0]?.clientY ?? 0;
    setDragging(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragging) return;
    const y = (e.touches[0]?.clientY ?? 0) - startYRef.current;
    if (y > 0) setDragY(y); // only allow downward drag
  }, [dragging]);

  const handleTouchEnd = useCallback(() => {
    setDragging(false);
    // Dismiss if dragged more than 120px, or past 25% of sheet height
    const threshold = Math.min(120, (sheetRef.current?.offsetHeight ?? 400) * 0.25);
    if (dragY > threshold) {
      onClose();
    } else {
      setDragY(0);
    }
  }, [dragY, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Sheet — full-width bottom on mobile, centered modal on desktop when enabled */}
      <div
        ref={sheetRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragging ? 'none' : 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
          paddingBottom: `max(env(safe-area-inset-bottom, 0px), 1.5rem)`,
        }}
        className={[
          'relative z-10 w-full bg-slate-900/95 backdrop-blur-2xl border-white/10',
          'rounded-t-3xl shadow-[0_-20px_60px_rgba(0,0,0,0.5)]',
          'animate-sheet-up',
          desktopAsModal
            ? 'md:max-w-md md:rounded-3xl md:shadow-[0_0_80px_rgba(0,0,0,0.6)] md:animate-in md:fade-in md:zoom-in-95'
            : 'md:max-w-md md:rounded-3xl',
          'md:my-auto',
        ].join(' ')}
      >
        {/* Drag handle — visible on mobile only */}
        <div className="flex justify-center pt-3 pb-2 md:hidden">
          <div className="w-10 h-1 bg-white/20 rounded-full" />
        </div>

        {title && (
          <div className="px-6 pt-2 md:pt-6 pb-4 flex items-center justify-between">
            <h3 className="text-lg font-black font-display text-white">{title}</h3>
          </div>
        )}

        <div className="px-6 pb-2 md:pb-6 max-h-[75dvh] overflow-y-auto custom-scrollbar">
          {children}
        </div>
      </div>
    </div>
  );
};

export default BottomSheet;
