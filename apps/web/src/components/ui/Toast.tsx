"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type ToastVariant = "success" | "error" | "info";

export type ToastOptions = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Millisekunden bis zum automatischen Ausblenden. 0 = bleibt stehen. */
  duration?: number;
  /** Optionale Rückgängig-Aktion, direkt im Toast. */
  action?: { label: string; onClick: () => void };
};

type Toast = ToastOptions & { id: number };

type ToastApi = {
  toast: (options: ToastOptions) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Zugriff auf die Toasts. Bewusst fehlertolerant: wird der Hook ausserhalb
 * des Providers benutzt (z. B. in einem isolierten Test-Render), fällt er
 * auf einen No-Op zurück statt die Seite zu zerlegen.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  return (
    ctx ?? {
      toast: () => {},
      dismiss: () => {},
    }
  );
}

const STYLES: Record<
  ToastVariant,
  { icon: React.ComponentType<{ className?: string }>; tone: string }
> = {
  success: { icon: CheckCircle2, tone: "text-emerald-500" },
  error: { icon: AlertTriangle, tone: "text-danger" },
  info: { icon: Info, tone: "text-accent" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mounted, setMounted] = useState(false);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => setMounted(true), []);

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { ...options, id }]);
      const duration = options.duration ?? 5000;
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
    },
    [dismiss],
  );

  // Alle offenen Timer beim Unmount aufräumen.
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {mounted &&
        createPortal(
          <div
            // polite + status: Screenreader lesen neue Toasts vor, ohne
            // die aktuelle Ansage zu unterbrechen.
            role="status"
            aria-live="polite"
            aria-relevant="additions"
            className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
          >
            {toasts.map((t) => {
              const { icon: Icon, tone } = STYLES[t.variant ?? "info"];
              return (
                <div
                  key={t.id}
                  className="pointer-events-auto flex animate-[rise_0.25s_cubic-bezier(0.22,1,0.36,1)_both] items-start gap-3 rounded-xl border border-line bg-elevated p-3.5 shadow-pop"
                >
                  <Icon className={cn("mt-0.5 h-[18px] w-[18px] shrink-0", tone)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium leading-snug text-ink">
                      {t.title}
                    </p>
                    {t.description && (
                      <p className="mt-0.5 text-[12px] leading-snug text-muted">
                        {t.description}
                      </p>
                    )}
                    {t.action && (
                      <button
                        type="button"
                        onClick={() => {
                          t.action?.onClick();
                          dismiss(t.id);
                        }}
                        className="mt-1.5 text-[12px] font-medium text-accent hover:underline"
                      >
                        {t.action.label}
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(t.id)}
                    aria-label="Meldung schliessen"
                    className="-m-1 grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-subtle hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
