import { Logo } from "@/components/ui/Logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Brand-Hero */}
      <div className="relative hidden w-1/2 overflow-hidden border-r border-line bg-subtle lg:block">
        <div
          className="absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(60% 50% at 20% 15%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 70%), radial-gradient(50% 50% at 85% 80%, color-mix(in oklab, #a855f7 18%, transparent), transparent 70%)",
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.4]"
          style={{
            backgroundImage:
              "linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage:
              "radial-gradient(ellipse 80% 70% at 50% 40%, black, transparent)",
          }}
        />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Logo />
          <div className="max-w-md animate-[rise_0.6s_ease]">
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-ink">
              Wissen, das euer
              <br />
              Team wirklich teilt.
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed text-muted">
              Schreibt gemeinsam in Echtzeit — mit Live-Cursorn,
              Versionsverlauf und blitzschneller Suche. Schön, schnell,
              selbst gehostet.
            </p>
            <div className="mt-8 flex items-center gap-3">
              <div className="flex -space-x-2">
                {["from-indigo-500 to-violet-500", "from-sky-500 to-cyan-500", "from-rose-500 to-pink-500"].map(
                  (g, i) => (
                    <span
                      key={i}
                      className={`h-8 w-8 rounded-full bg-gradient-to-br ${g} ring-2 ring-subtle`}
                    />
                  ),
                )}
              </div>
              <span className="text-sm text-faint">
                Live zusammen bearbeiten
              </span>
            </div>
          </div>
          <p className="text-xs text-faint">
            © {new Date().getFullYear()} dokunc
          </p>
        </div>
      </div>

      {/* Form */}
      <div className="flex w-full items-center justify-center px-6 lg:w-1/2">
        <div className="w-full max-w-sm animate-[rise_0.5s_ease]">
          {children}
        </div>
      </div>
    </div>
  );
}
