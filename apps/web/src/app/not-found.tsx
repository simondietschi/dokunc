import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <div>
        <p className="text-5xl font-semibold tracking-tight">404</p>
        <p className="mt-2 text-muted">
          Diese Seite gibt es nicht (mehr).
        </p>
      </div>
      <Link href="/spaces">
        <Button variant="secondary">Zu deinen Spaces</Button>
      </Link>
    </div>
  );
}
