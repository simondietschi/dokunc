import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { stagger } from "../../stagger";

export default function InvalidInvite() {
  return (
    <div>
      <div
        className="grid h-12 w-12 place-items-center rounded-2xl border border-danger/30 bg-danger/10"
        style={stagger(0)}
      >
        <ShieldAlert className="h-5 w-5 text-danger" />
      </div>
      <h2
        className="mt-5 text-2xl font-semibold tracking-tight text-ink"
        style={stagger(1)}
      >
        Einladung ungültig
      </h2>
      <p
        className="mt-2 text-sm leading-relaxed text-muted"
        style={stagger(2)}
      >
        Dieser Einladungslink ist abgelaufen, wurde bereits genutzt oder
        ist ungültig. Bitte deinen Admin um eine neue Einladung.
      </p>
      <p className="mt-8 text-sm text-muted" style={stagger(3)}>
        Schon ein Konto?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Anmelden
        </Link>
      </p>
    </div>
  );
}
