import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ScrollText } from "lucide-react";
import { prisma } from "@dokunc/db";
import { requireAdmin } from "@/lib/current-user";
import { AUDIT_LABELS, auditLabel, type AuditAction } from "@/lib/audit";

export const metadata: Metadata = {
  title: "Audit-Log",
  description: "Sicherheitsrelevante Ereignisse dieser Instanz.",
};

const PAGE_SIZE = 100;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  await requireAdmin();
  const { action } = await searchParams;
  const filter = action && action in AUDIT_LABELS ? action : undefined;

  const entries = await prisma.auditLog.findMany({
    where: filter ? { action: filter } : undefined,
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
    select: {
      id: true,
      action: true,
      targetId: true,
      metadata: true,
      ip: true,
      createdAt: true,
      actor: { select: { name: true, email: true } },
      space: { select: { name: true, slug: true } },
    },
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 animate-[rise_0.4s_ease]">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Administration
      </Link>
      <h1 className="mt-3 flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <ScrollText className="h-5 w-5 text-muted" />
        Audit-Log
      </h1>
      <p className="mt-1 text-sm text-muted">
        Die {PAGE_SIZE} jüngsten sicherheitsrelevanten Ereignisse. Einträge
        werden nur angehängt, nie geändert.
      </p>

      <form className="mt-6 flex items-center gap-2">
        <label htmlFor="action" className="text-[13px] text-muted">
          Ereignis
        </label>
        <select
          id="action"
          name="action"
          defaultValue={filter ?? ""}
          className="h-9 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink focus-visible:border-accent focus-visible:outline-none"
        >
          <option value="">Alle</option>
          {(Object.keys(AUDIT_LABELS) as AuditAction[]).map((key) => (
            <option key={key} value={key}>
              {AUDIT_LABELS[key]}
            </option>
          ))}
        </select>
        <button className="h-9 rounded-lg border border-line bg-surface px-3 text-[13px] text-ink transition-colors hover:border-line-strong">
          Filtern
        </button>
      </form>

      {entries.length === 0 ? (
        <p className="mt-10 rounded-xl border border-dashed border-line-strong bg-subtle/40 px-4 py-10 text-center text-sm text-muted">
          Noch keine Ereignisse aufgezeichnet.
        </p>
      ) : (
        <ul className="mt-6 space-y-1.5">
          {entries.map((e) => (
            <li
              key={e.id}
              className="rounded-xl border border-line bg-surface px-3.5 py-3 text-[13px] shadow-soft"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-ink">
                  {auditLabel(e.action)}
                </span>
                <time
                  dateTime={e.createdAt.toISOString()}
                  className="text-xs text-faint"
                >
                  {e.createdAt.toLocaleString("de-CH")}
                </time>
              </div>
              <p className="mt-1 text-muted">
                {e.actor
                  ? `${e.actor.name} (${e.actor.email})`
                  : "unbekannt"}
                {e.space && ` · Space ${e.space.name}`}
                {e.ip && ` · ${e.ip}`}
              </p>
              {(e.targetId || e.metadata) && (
                <p className="mt-0.5 break-all font-mono text-[11.5px] text-faint">
                  {e.targetId && `→ ${e.targetId}`}
                  {e.metadata ? ` ${JSON.stringify(e.metadata)}` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
