import { ShieldAlert } from "lucide-react";
import { InviteShell } from "../InviteShell";

export default function InvalidInvite() {
  return (
    <InviteShell>
      <ShieldAlert className="h-8 w-8 text-danger" />
      <h1 className="mt-4 text-xl font-semibold">Einladung ungültig</h1>
      <p className="mt-2 text-sm text-muted">
        Dieser Einladungslink ist abgelaufen, wurde bereits genutzt oder
        ist ungültig.
      </p>
    </InviteShell>
  );
}
