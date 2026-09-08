"use client";

import { useRef } from "react";
import { changeRoleAction } from "./actions";

const ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

/**
 * Rollenauswahl einer Mitgliedschaft. `canManageOwners` spiegelt die
 * Server-Regel: OWNER vergibt und entzieht nur, wer selbst OWNER ist.
 * Ohne dieses Recht ist die Auswahl bei einem OWNER gesperrt und die
 * Option OWNER gar nicht erst vorhanden — sonst waere die Auswahl
 * anklickbar, wuerde aber serverseitig still verworfen.
 */
export function RoleSelect({
  slug,
  memberId,
  role,
  canManageOwners,
}: {
  slug: string;
  memberId: string;
  role: string;
  canManageOwners: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const locked = !canManageOwners && role === "OWNER";
  const options = ROLES.filter(
    (r) => canManageOwners || r !== "OWNER" || role === "OWNER",
  );

  return (
    <form ref={ref} action={changeRoleAction}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="memberId" value={memberId} />
      <select
        name="role"
        defaultValue={role}
        disabled={locked}
        title={
          locked ? "Nur Owner können die Rolle eines Owners ändern." : undefined
        }
        onChange={() => ref.current?.requestSubmit()}
        className="h-8 rounded-md border border-line bg-surface px-2 text-[13px] text-ink disabled:opacity-50 focus-visible:border-accent focus-visible:outline-none"
      >
        {options.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </form>
  );
}
