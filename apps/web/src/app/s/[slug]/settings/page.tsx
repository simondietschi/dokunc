import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, ShieldAlert, SlidersHorizontal, Users } from "lucide-react";
import { prisma } from "@dokunc/db";
import { loadSpace } from "@/lib/space-context";
import { can } from "@/lib/permissions";
import { GeneralForm, DeleteSpaceForm } from "./SettingsForms";

export default async function SpaceSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { space, role } = await loadSpace(slug);
  if (!can(role, "manageSpace")) redirect(`/s/${slug}`);

  const memberCount = await prisma.spaceMember.count({
    where: { spaceId: space.id },
  });

  return (
    <div className="mx-auto max-w-2xl px-8 py-14 animate-[rise_0.4s_ease]">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <SlidersHorizontal className="h-5 w-5 text-muted" />
        Einstellungen
      </h1>
      <p className="mt-1 text-sm text-muted">
        Verwalte „{space.name}“ — Name, Icon, Mitglieder und Gefahrenzone.
      </p>

      <div className="mt-8 space-y-6">
        <GeneralForm
          slug={slug}
          name={space.name}
          description={space.description}
          icon={space.icon}
        />

        <section className="rounded-xl border border-line bg-surface p-5 shadow-soft">
          <h2 className="text-sm font-semibold">Mitglieder</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {memberCount} {memberCount === 1 ? "Person hat" : "Personen haben"}{" "}
            Zugriff auf diesen Space.
          </p>
          <Link
            href={`/s/${slug}/members`}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-subtle"
          >
            <Users className="h-4 w-4 text-muted" />
            Mitglieder und Einladungen verwalten
            <ArrowUpRight className="h-3.5 w-3.5 text-faint" />
          </Link>
        </section>

        <section className="rounded-xl border border-danger/30 bg-surface p-5 shadow-soft">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-danger">
            <ShieldAlert className="h-4 w-4" />
            Gefahrenzone
          </h2>
          <div className="mt-3">
            {role === "OWNER" ? (
              <DeleteSpaceForm slug={slug} name={space.name} />
            ) : (
              <p className="text-[13px] text-muted">
                Nur Owner können diesen Space löschen. Wende dich an eine
                Person mit der Rolle Owner, wenn der Space entfernt werden
                soll.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
