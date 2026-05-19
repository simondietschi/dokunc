import { MailWarning } from "lucide-react";
import { InviteShell } from "../InviteShell";

export default function MismatchInvite() {
  return (
    <InviteShell>
      <MailWarning className="h-8 w-8 text-amber-500" />
      <h1 className="mt-4 text-xl font-semibold">Falsches Konto</h1>
      <p className="mt-2 text-sm text-muted">
        Diese Einladung gilt für eine andere E-Mail-Adresse. Melde dich
        mit der eingeladenen Adresse an und öffne den Link erneut.
      </p>
    </InviteShell>
  );
}
