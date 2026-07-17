import { Logo } from "@/components/ui/Logo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Users, Sparkles, ShieldCheck } from "lucide-react";

/** Animierter Fake-Kollaborations-Cursor für die Produktvorschau. */
function PreviewCursor({
  className,
  color,
  name,
  style,
}: {
  className: string;
  color: string;
  name: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`dk-preview-cursor ${className}`} style={style}>
      <svg width="14" height="18" viewBox="0 0 14 18" fill="none">
        <path
          d="M1 1l4.5 15 2.6-6.2L14 7.6 1 1z"
          fill={color}
          stroke="white"
          strokeWidth="1"
        />
      </svg>
      <span className="label" style={{ background: color }}>
        {name}
      </span>
    </div>
  );
}

/** Miniatur-Editor: zeigt das Produkt (Realtime-Wiki) statt Deko. */
function ProductPreview() {
  return (
    <div className="dk-preview animate-[rise_0.7s_ease_both] [animation-delay:200ms]">
      {/* Fenster-Kopf */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 text-[11px] font-medium text-faint">
          Engineering / Onboarding
        </span>
        <span className="ml-auto flex -space-x-1.5">
          <span className="h-5 w-5 rounded-full bg-gradient-to-br from-sky-500 to-cyan-500 ring-2 ring-surface" />
          <span className="h-5 w-5 rounded-full bg-gradient-to-br from-rose-500 to-pink-500 ring-2 ring-surface" />
          <span className="h-5 w-5 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 ring-2 ring-surface" />
        </span>
      </div>

      {/* Inhalt */}
      <div className="relative px-6 py-5">
        <p className="text-[17px] font-bold tracking-tight">
          Onboarding-Guide
        </p>
        <div className="mt-3 space-y-2">
          <div className="h-2 w-11/12 rounded bg-line-strong/70" />
          <div className="h-2 w-3/4 rounded bg-line-strong/70" />
          <p className="pt-1 text-[12.5px] leading-relaxed text-muted">
            Willkommen im Team! Alles Wichtige für deine erste Woche
            findest du hier<span className="dk-caret ml-0.5" />
          </p>
        </div>
        <div className="mt-3 rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-2">
          <div className="h-2 w-2/3 rounded bg-sky-400/40" />
        </div>
        <div className="mt-3 space-y-2">
          <div className="h-2 w-5/6 rounded bg-line-strong/70" />
          <div className="h-2 w-1/2 rounded bg-line-strong/70" />
        </div>

        {/* Live-Cursor */}
        <PreviewCursor
          className="dk-cursor-a"
          color="#0ea5e9"
          name="Kim"
          style={{ top: "38%", left: "12%" }}
        />
        <PreviewCursor
          className="dk-cursor-b"
          color="#ec4899"
          name="Alex"
          style={{ top: "62%", right: "18%" }}
        />
      </div>
    </div>
  );
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Brand-Hero */}
      <div className="dk-noise relative hidden w-1/2 overflow-hidden border-r border-line bg-subtle lg:block">
        {/* Animierte Farbfelder */}
        <div
          className="absolute -left-1/4 -top-1/4 h-[70%] w-[70%] rounded-full opacity-70 blur-3xl [animation:dk-drift-a_22s_ease-in-out_infinite]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in oklab, var(--accent) 28%, transparent), transparent 70%)",
          }}
        />
        <div
          className="absolute -bottom-1/4 -right-1/4 h-[65%] w-[65%] rounded-full opacity-60 blur-3xl [animation:dk-drift-b_26s_ease-in-out_infinite]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in oklab, #a855f7 22%, transparent), transparent 70%)",
          }}
        />
        {/* Raster */}
        <div
          className="absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage:
              "linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage:
              "radial-gradient(ellipse 90% 80% at 50% 40%, black 30%, transparent)",
          }}
        />

        <div className="relative flex h-full flex-col p-12">
          <Logo />

          <div className="my-auto max-w-lg py-10">
            <h1 className="animate-[rise_0.6s_ease_both] text-[2.6rem] font-semibold leading-[1.12] tracking-tight text-ink">
              Wissen, das euer Team{" "}
              <span className="bg-gradient-to-r from-accent to-violet-500 bg-clip-text text-transparent">
                wirklich teilt
              </span>
              .
            </h1>
            <p className="mt-4 animate-[rise_0.6s_ease_both] text-[15px] leading-relaxed text-muted [animation-delay:100ms]">
              Schreibt gemeinsam in Echtzeit — mit Live-Cursorn,
              Versionsverlauf und einer KI, die euer Wiki kennt.
            </p>

            <div className="mt-9">
              <ProductPreview />
            </div>

            <div className="mt-7 flex flex-wrap gap-2 animate-[rise_0.6s_ease_both] [animation-delay:320ms]">
              {[
                { icon: Users, label: "Echtzeit-Kollaboration" },
                { icon: Sparkles, label: "Frag dein Wiki (KI)" },
                { icon: ShieldCheck, label: "Self-hosted" },
              ].map(({ icon: Icon, label }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface/70 px-3 py-1.5 text-[12.5px] font-medium text-muted backdrop-blur"
                >
                  <Icon className="h-3.5 w-3.5 text-accent" />
                  {label}
                </span>
              ))}
            </div>
          </div>

          <p className="text-xs text-faint">
            © {new Date().getFullYear()} dokunc — Open-Source-Team-Wiki
          </p>
        </div>
      </div>

      {/* Formular */}
      <div className="relative flex w-full items-center justify-center px-6 lg:w-1/2">
        <div className="absolute right-5 top-5">
          <ThemeToggle />
        </div>
        <div className="w-full max-w-sm animate-[rise_0.5s_ease]">
          {children}
        </div>
      </div>
    </div>
  );
}
