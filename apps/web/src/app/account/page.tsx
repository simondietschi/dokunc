import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Download, LogOut, Monitor } from "lucide-react";
import { prisma } from "@dokunc/db";
import { requireUser } from "@/lib/current-user";
import { describeDevice } from "@/lib/user-agent";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import {
  ProfileForm,
  PasswordForm,
  NotificationForm,
  DeleteAccountForm,
} from "./AccountForms";
import { TwoFactorForm } from "./TwoFactorForm";
import { logoutEverywhereAction, revokeSessionAction } from "./actions";

export const metadata: Metadata = {
  title: "Konto",
  description: "Profil, Passwort und angemeldete Geräte.",
};

export default async function AccountPage() {
  const user = await requireUser();

  const prefs = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      emailOnMention: true,
      emailOnComment: true,
      totpEnabledAt: true,
    },
  });
  const unusedCodes = prefs?.totpEnabledAt
    ? await prisma.totpRecoveryCode.count({
        where: { userId: user.id, usedAt: null },
      })
    : 0;

  const sessions = await prisma.session.findMany({
    where: {
      userId: user.id,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { lastSeenAt: "desc" },
    select: {
      id: true,
      userAgent: true,
      ip: true,
      createdAt: true,
      lastSeenAt: true,
    },
    take: 30,
  });

  return (
    <div className="mx-auto max-w-xl px-6 py-12 animate-[rise_0.4s_ease]">
      <Link
        href="/spaces"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Zurück
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">
        Konto
      </h1>
      <p className="mt-1 text-sm text-muted">{user.email}</p>

      <div className="mt-8 space-y-5">
        <ProfileForm name={user.name} />
        <PasswordForm />
        <TwoFactorForm
          enabled={!!prefs?.totpEnabledAt}
          enabledAt={
            prefs?.totpEnabledAt
              ? prefs.totpEnabledAt.toLocaleDateString("de-CH", {
                  dateStyle: "medium",
                })
              : null
          }
          unusedCodes={unusedCodes}
        />
        <NotificationForm
          emailOnMention={prefs?.emailOnMention ?? true}
          emailOnComment={prefs?.emailOnComment ?? true}
        />
        <div className="rounded-xl border border-line bg-surface p-5 shadow-soft">
          <h2 className="text-sm font-semibold">
            Angemeldete Geräte ({sessions.length})
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            Jede Anmeldung lässt sich einzeln beenden.
          </p>

          <ul className="mt-3 space-y-2">
            {sessions.map((s) => {
              const current = s.id === user.sessionId;
              return (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Monitor className="h-4 w-4 shrink-0 text-faint" />
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">
                        {describeDevice(s.userAgent)}
                        {current && (
                          <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-normal text-accent">
                            dieses Gerät
                          </span>
                        )}
                      </p>
                      <p className="truncate text-[11.5px] text-faint">
                        {s.ip ? `${s.ip} · ` : ""}zuletzt{" "}
                        <time dateTime={s.lastSeenAt.toISOString()}>
                          {s.lastSeenAt.toLocaleString("de-CH", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </time>
                      </p>
                    </div>
                  </div>
                  <form action={revokeSessionAction}>
                    <input type="hidden" name="sessionId" value={s.id} />
                    <ConfirmButton
                      title="Gerät abmelden"
                      message={
                        current
                          ? "Dieses Gerät abmelden? Du landest wieder auf der Anmeldeseite."
                          : "Dieses Gerät abmelden?"
                      }
                      confirmLabel="Abmelden"
                      className="grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-danger/10 hover:text-danger"
                    >
                      <LogOut className="h-4 w-4" />
                    </ConfirmButton>
                  </form>
                </li>
              );
            })}
          </ul>

          <form action={logoutEverywhereAction} className="mt-4">
            <Button variant="secondary" type="submit">
              Überall abmelden
            </Button>
          </form>
        </div>

        <div className="rounded-xl border border-line bg-surface p-5 shadow-soft">
          <h2 className="text-sm font-semibold">Deine Daten</h2>
          <p className="mt-1 text-[13px] text-muted">
            Alles, was diese Instanz über dich gespeichert hat, als
            JSON-Datei.
          </p>
          <a
            href="/api/account/export"
            download
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:bg-subtle hover:text-ink"
          >
            <Download className="h-3.5 w-3.5" />
            Daten herunterladen
          </a>
        </div>

        <DeleteAccountForm />
      </div>
    </div>
  );
}
