import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Download, Monitor } from "lucide-react";
import { prisma } from "@dokunc/db";
import { isMailConfigured } from "@dokunc/mail";
import { requireUser } from "@/lib/current-user";
import { oidcConfig } from "@/lib/oidc";
import { passwordBlockedBySso } from "@/lib/sso-policy";
import { countActiveRecoveryCodes } from "@/lib/totp-store";
import { describeDevice } from "@/lib/user-agent";
import {
  ProfileForm,
  PasswordForm,
  NotificationPrefsForm,
  DeleteAccountForm,
} from "./AccountForms";
import { TwoFactorForm } from "./TwoFactorForm";
import { LogoutEverywhereForm, RevokeSessionForm } from "./SessionForms";

export const metadata: Metadata = {
  title: "Konto",
  description: "Profil, Passwort und angemeldete Geräte.",
};

export default async function AccountPage() {
  const user = await requireUser();
  const prefs = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      emailNotifications: true,
      totpEnabledAt: true,
      oidcSubject: true,
    },
  });
  // Konto mit SSO-Bindung: das Passwort gilt nicht für die Anmeldung
  // (lib/sso-policy). Die Formulare bleiben, weil verknüpfte Altkonten
  // ihr Passwort kennen und es für Löschen und Zwei-Faktor brauchen.
  const ssoLabel =
    prefs && passwordBlockedBySso(prefs)
      ? (oidcConfig()?.label ?? "Single Sign-on")
      : null;
  // Nur bestätigte Codes zählen: ein ausstehender Satz hilft im Notfall
  // nicht, und die Zahl soll genau das sagen.
  const unusedCodes = prefs?.totpEnabledAt
    ? await countActiveRecoveryCodes(user.id)
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
        {ssoLabel && (
          <p className="rounded-xl border border-line bg-subtle px-5 py-4 text-[13px] leading-relaxed text-muted">
            Dein Konto meldet sich über „{ssoLabel}" an. Das Passwort gilt
            nicht für die Anmeldung, es bestätigt nur Aktionen auf dieser
            Seite. Hast du nie eines gesetzt, kann die Administration dein
            Konto löschen oder die Zwei-Faktor-Anmeldung zurücksetzen.
          </p>
        )}
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
        <NotificationPrefsForm
          mode={prefs?.emailNotifications ?? "INSTANT"}
          mailConfigured={isMailConfigured()}
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
                  <RevokeSessionForm sessionId={s.id} current={current} />
                </li>
              );
            })}
          </ul>

          <LogoutEverywhereForm />
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
