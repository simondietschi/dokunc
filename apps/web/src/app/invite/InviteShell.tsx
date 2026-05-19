import { Logo } from "@/components/ui/Logo";

export function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md animate-[rise_0.5s_ease]">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-line bg-surface p-8 shadow-soft">
          {children}
        </div>
      </div>
    </div>
  );
}
