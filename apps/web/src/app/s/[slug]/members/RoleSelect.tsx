"use client";

import { useRef } from "react";
import { changeRoleAction } from "./actions";

/**
 * Die angebotenen Rollen kommen von der Seite, nicht aus einer festen
 * Liste: sie stammen aus derselben Regel, die die Server Action
 * durchsetzt (lib/role-policy). Was hier fehlt, wird auch serverseitig
 * abgelehnt — die Auswahl kann also gar nicht erst ins Leere laufen.
 * Damit deckt `disabled` auch den Fall ab, den main separat behandelt
 * hat: die eigene Zeile und die Rolle eines OWNER bleiben gesperrt.
 */
export function RoleSelect({
  slug,
  memberId,
  role,
  roles,
  disabled,
  disabledReason,
}: {
  slug: string;
  memberId: string;
  role: string;
  roles: readonly string[];
  disabled?: boolean;
  disabledReason?: string;
}) {
  const ref = useRef<HTMLFormElement>(null);

  return (
    <form ref={ref} action={changeRoleAction}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="memberId" value={memberId} />
      <select
        name="role"
        defaultValue={role}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        aria-label="Rolle"
        onChange={() => ref.current?.requestSubmit()}
        className="h-8 rounded-md border border-line bg-surface px-2 text-[13px] text-ink disabled:opacity-50 focus-visible:border-accent focus-visible:outline-none"
      >
        {/* Die aktuelle Rolle muss wählbar bleiben, auch wenn sie
            (etwa OWNER) nicht vergeben werden darf. */}
        {(roles.includes(role) ? roles : [role, ...roles]).map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </form>
  );
}
