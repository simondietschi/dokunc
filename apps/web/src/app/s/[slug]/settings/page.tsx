import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, DoorOpen } from "lucide-react";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Input, Field } from "@/components/ui/Input";
import { leaveSpaceAction, updateSpaceAction } from "@/app/spaces/actions";

export const metadata: Metadata = {
  title: "Space-Einstellungen",
  description: "Name, Beschreibung und Sichtbarkeit dieses Space.",
};

export default async function SpaceSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { space, role, user } = await loadSpace(slug);
  if (!can(role, "manageSpace")) redirect(`/s/${slug}`);

  const ownerCount = await prisma.spaceMember.count({
    where: { spaceId: space.id, role: "OWNER" },
  });
  const lastOwner = role === "OWNER" && ownerCount <= 1;

  return (
    <div className="mx-auto max-w-2xl px-8 py-14 animate-[rise_0.4s_ease]">
      <Link
        href={`/s/${slug}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Zurück zum Space
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">
        Einstellungen
      </h1>
      <p className="mt-1 text-sm text-muted">{space.name}</p>

      <form
        action={updateSpaceAction}
        className="mt-8 space-y-4 rounded-xl border border-line bg-surface p-5 shadow-soft"
      >
        <input type="hidden" name="slug" value={slug} />
        <Field label="Name">
          <Input name="name" defaultValue={space.name} required minLength={2} />
        </Field>
        <Field label="Beschreibung">
          <Input
            name="description"
            defaultValue={space.description ?? ""}
            placeholder="Wofür ist dieser Space da?"
          />
        </Field>

        <div>
          <label
            htmlFor="visibility"
            className="mb-1.5 block text-[13px] font-medium text-muted"
          >
            Sichtbarkeit
          </label>
          <select
            id="visibility"
            name="visibility"
            defaultValue={space.visibility}
            className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus-visible:border-accent focus-visible:outline-none"
          >
            <option value="PRIVATE">
              Privat — nur mit Einladung sichtbar
            </option>
            <option value="OPEN">
              Offen — für alle Angemeldeten auffindbar
            </option>
          </select>
        </div>

        <div>
          <label
            htmlFor="joinRole"
            className="mb-1.5 block text-[13px] font-medium text-muted"
          >
            Rolle beim Beitritt
          </label>
          <select
            id="joinRole"
            name="joinRole"
            defaultValue={space.joinRole}
            className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus-visible:border-accent focus-visible:outline-none"
          >
            <option value="MEMBER">MEMBER — darf schreiben</option>
            <option value="VIEWER">VIEWER — darf lesen und kommentieren</option>
          </select>
          <p className="mt-1.5 text-[12.5px] text-faint">
            Gilt nur für offene Spaces. Einladungen legen ihre Rolle selbst
            fest.
          </p>
        </div>

        <div className="pt-1">
          <Button type="submit">Speichern</Button>
        </div>
      </form>

      <div className="mt-5 rounded-xl border border-line bg-surface p-5 shadow-soft">
        <h2 className="text-sm font-semibold">Space verlassen</h2>
        <p className="mt-1 text-[13px] text-muted">
          {lastOwner
            ? "Du bist der letzte Eigentümer. Ernenne zuerst jemand anderen, sonst bliebe der Space ohne Verwaltung zurück."
            : `Du verlierst den Zugriff auf „${space.name}". Eine Einladung bringt dich zurück.`}
        </p>
        {!lastOwner && (
          <form action={leaveSpaceAction} className="mt-3">
            <input type="hidden" name="slug" value={slug} />
            <ConfirmButton
              title="Space verlassen"
              message={`„${space.name}" wirklich verlassen? Du siehst die Inhalte danach nicht mehr.`}
              confirmLabel="Verlassen"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <DoorOpen className="h-3.5 w-3.5" />
              Verlassen
            </ConfirmButton>
          </form>
        )}
      </div>

      <p className="mt-4 text-[12.5px] text-faint">
        Angemeldet als {user.name}.
      </p>
    </div>
  );
}
