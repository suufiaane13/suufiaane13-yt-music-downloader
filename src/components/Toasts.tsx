import { useEffect, useRef, useState } from "react";

export type ToastKind = "success" | "error" | "warning" | "info";

export interface ToastOpts {
  kind: ToastKind;
  title: string;
  message?: string;
  ttlMs?: number;
}

interface ToastItem extends ToastOpts {
  id: number;
}

let seq = 0;

export function toast(opts: ToastOpts) {
  window.dispatchEvent(new CustomEvent("ytmd-toast", { detail: { ...opts, id: ++seq } }));
}

export const toastSuccess = (title: string, message?: string) => toast({ kind: "success", title, message });
export const toastError = (title: string, message?: string) =>
  toast({ kind: "error", title, message, ttlMs: 7000 });
export const toastWarning = (title: string, message?: string) => toast({ kind: "warning", title, message });

const DEFAULT_TTL: Record<ToastKind, number> = {
  success: 4500,
  error: 7000,
  warning: 5500,
  info: 4500,
};

const MAX_TOASTS = 4;

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastItem>).detail;
      setItems((prev) => {
        const next = [...prev, detail];
        return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
      });
      const timer = window.setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== detail.id));
      }, detail.ttlMs ?? DEFAULT_TTL[detail.kind]);
      timersRef.current.push(timer);
    };
    window.addEventListener("ytmd-toast", onToast as EventListener);
    return () => {
      window.removeEventListener("ytmd-toast", onToast as EventListener);
      timersRef.current.forEach((t) => window.clearTimeout(t));
      timersRef.current = [];
    };
  }, []);

  const dismiss = (id: number) => setItems((prev) => prev.filter((t) => t.id !== id));

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-10 right-3 z-[80] flex flex-col items-end gap-1.5 pointer-events-none max-w-[360px]">
      {items.map((t) => (
        <div
          key={t.id}
          className={`boot-step-in pointer-events-auto w-[320px] max-w-[calc(100vw-1.5rem)] rounded-lg border px-3 py-2.5 shadow-[0_12px_40px_-12px_rgba(0,0,0,.7)] flex items-start gap-2.5 ${
            t.kind === "error"
              ? "bg-[#2a1416]/95 border-red-500/35"
              : t.kind === "warning"
              ? "bg-[#2b2010]/95 border-amber-500/35"
              : t.kind === "success"
              ? "bg-[#0f2519]/95 border-green-500/35"
              : "bg-dark-800/95 border-dark-600/70"
          }`}
        >
          <span className="w-4 h-4 mt-0.5 shrink-0 flex items-center justify-center">
            {t.kind === "error" ? (
              <ErrorIcon />
            ) : t.kind === "warning" ? (
              <WarningIcon />
            ) : t.kind === "success" ? (
              <SuccessIcon />
            ) : (
              <InfoIcon />
            )}
          </span>
          <div className="flex-1 min-w-0">
            <p
              className={`text-[12px] font-semibold leading-snug ${
                t.kind === "error"
                  ? "text-red-300"
                  : t.kind === "warning"
                  ? "text-amber-300"
                  : t.kind === "success"
                  ? "text-green-300"
                  : "text-dark-100"
              }`}
            >
              {t.title}
            </p>
            {t.message && <p className="text-[11px] text-dark-300 mt-0.5 leading-snug">{t.message}</p>}
          </div>
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 w-5 h-5 rounded-md flex items-center justify-center text-dark-500 hover:text-white hover:bg-white/10 transition-colors"
            title="Fermer"
          >
            <XIcon />
          </button>
        </div>
      ))}
    </div>
  );
}

function ErrorIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function SuccessIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-400">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}