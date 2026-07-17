import Link from "next/link";
import { MailWarning } from "lucide-react";
import { stagger } from "../../stagger";

export default function MismatchInvite() {
  return (
    <div>
      <div
        className="grid h-12 w-12 place-items-center rounded-2xl border border-amber-500/30 bg-amber-500/10"
        style={stagger(0)}
      >
        <MailWarning className="h-5 w-5 text-amber-500" />
      </div>
      <h2
        className="mt-5 text-2xl font-semibold tracking-tight text-ink"
        style={stagger(1)}
      >
        Falsches Konto
      </h2>
      <p
        className="mt-2 text-sm leading-relaxed text-muted"
        style={stagger(2)}
      >
        Diese Einladung gilt für eine andere E-Mail-Adresse. Melde dich
        mit der eingeladenen Adresse an und öffne den Link erneut.
      </p>
      <p className="mt-8 text-sm text-muted" style={stagger(3)}>
        <Link href="/login" className="font-medium text-accent hover:underline">
          Zur Anmeldung
        </Link>
      </p>
    </div>
  );
}
