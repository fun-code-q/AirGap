import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';

type ToastLevel = 'info' | 'success' | 'error';
interface ToastRecord {
  id: number;
  level: ToastLevel;
  message: string;
}

interface ToastAPI {
  show: (message: string, level?: ToastLevel) => void;
  error: (message: string) => void;
  success: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastAPI | null>(null);

/** Use inside any component rendered beneath `<ToastProvider>` to push toasts. */
export const useToast = (): ToastAPI => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast: missing <ToastProvider>');
  return ctx;
};

const TOAST_TTL_MS = 4500;
let nextId = 1;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const show = useCallback((message: string, level: ToastLevel = 'info') => {
    const id = nextId++;
    setToasts((t) => [...t, { id, level, message }]);
    window.setTimeout(() => dismiss(id), TOAST_TTL_MS);
  }, [dismiss]);

  const api: ToastAPI = {
    show,
    error:   (m) => show(m, 'error'),
    success: (m) => show(m, 'success'),
    info:    (m) => show(m, 'info'),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
};

const ToastViewport: React.FC<{ toasts: ToastRecord[]; dismiss: (id: number) => void }> = ({ toasts, dismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-md pointer-events-none"
      style={{ top: `calc(max(env(safe-area-inset-top, 0px), 1rem))` }}
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />)}
    </div>
  );
};

const levelStyles: Record<ToastLevel, { ring: string; iconBg: string; iconColor: string; Icon: typeof Info }> = {
  info:    { ring: 'border-violet-500/30',  iconBg: 'bg-violet-600/20',  iconColor: 'text-violet-400',  Icon: Info },
  success: { ring: 'border-emerald-500/30', iconBg: 'bg-emerald-600/20', iconColor: 'text-emerald-400', Icon: CheckCircle },
  error:   { ring: 'border-red-500/30',     iconBg: 'bg-red-600/20',     iconColor: 'text-red-400',     Icon: AlertCircle },
};

const ToastItem: React.FC<{ toast: ToastRecord; onDismiss: () => void }> = ({ toast, onDismiss }) => {
  const [exiting, setExiting] = useState(false);
  const { ring, iconBg, iconColor, Icon } = levelStyles[toast.level];

  // Slide out 180ms before the outer timer unmounts so the exit animation plays
  useEffect(() => {
    const handle = window.setTimeout(() => setExiting(true), TOAST_TTL_MS - 180);
    return () => window.clearTimeout(handle);
  }, []);

  return (
    <div
      className={`pointer-events-auto glass-card flex items-center gap-3 px-4 py-3 ${ring} shadow-[0_10px_40px_rgba(0,0,0,0.4)] ${
        exiting ? 'animate-out fade-out slide-out-to-top-4' : 'animate-in fade-in slide-in-from-top-4'
      } duration-200`}
    >
      <div className={`w-9 h-9 ${iconBg} rounded-xl flex items-center justify-center shrink-0`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <span className="text-sm font-bold text-slate-100 flex-1 leading-tight">{toast.message}</span>
      <button onClick={onDismiss} aria-label="Dismiss" className="btn-icon text-slate-500 hover:text-white -mr-1 shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default ToastProvider;
