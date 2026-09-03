import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@dokunc/db";
import { isMailConfigured } from "@dokunc/mail";
import { requireUser } from "@/lib/current-user";
import { Button } from "@/components/ui/Button";
import {
  ProfileForm,
  PasswordForm,
  NotificationPrefsForm,
} from "./AccountForms";
import { logoutEverywhereAction } from "./actions";

export default async function AccountPage() {
  const user = await requireUser();
  const prefs = await prisma.user.findUnique({
    where: { id: user.id },
    select: { emailNotifications: true },
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
        <NotificationPrefsForm
          mode={prefs?.emailNotifications ?? "INSTANT"}
          mailConfigured={isMailConfigured()}
        />
        <div className="rounded-xl border border-line bg-surface p-5 shadow-soft">
          <h2 className="text-sm font-semibold">Sitzungen</h2>
          <p className="mt-1 text-[13px] text-muted">
            Meldet dich auf allen Geräten ab (auch hier).
          </p>
          <form action={logoutEverywhereAction} className="mt-3">
            <Button variant="secondary" type="submit">
              Überall abmelden
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
