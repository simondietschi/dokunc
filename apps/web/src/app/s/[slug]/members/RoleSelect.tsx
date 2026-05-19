"use client";

import { useRef } from "react";
import { changeRoleAction } from "./actions";

const ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

export function RoleSelect({
  slug,
  memberId,
  role,
  disabled,
}: {
  slug: string;
  memberId: string;
  role: string;
  disabled?: boolean;
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
        onChange={() => ref.current?.requestSubmit()}
        className="h-8 rounded-md border border-line bg-surface px-2 text-[13px] text-ink disabled:opacity-50 focus-visible:border-accent focus-visible:outline-none"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </form>
  );
}
