import "server-only";
import { notFound, redirect } from "next/navigation";
import { prisma, type Space, type SpaceRole } from "@dokunc/db";
import { requireUser } from "@/lib/current-user";
import { can, type Action } from "@/lib/permissions";
import { str } from "@/lib/form";

type Access = {
  user: { id: string; email: string; name: string };
  space: Space;
  role: SpaceRole;
};

/**
 * Gemeinsame Auflösung: angemeldeter User + Space + dessen Rolle.
 * Space und Mitgliedschaft werden in EINER Query geladen.
 */
async function resolve(slug: string) {
  const user = await requireUser();
  const space = await prisma.space.findUnique({
    where: { slug },
    include: {
      members: {
        where: { userId: user.id },
        select: { role: true },
      },
    },
  });
  const role = space?.members[0]?.role ?? null;
  return { user, space, role };
}

/**
 * Für Seiten/Layouts: leitet sauber um statt zu werfen.
 * 404 wenn Space fehlt, zurück zur Übersicht wenn kein Zugriff.
 */
export async function loadSpace(slug: string): Promise<Access> {
  const { user, space, role } = await resolve(slug);
  if (!space) notFound();
  if (!role) redirect("/spaces");
  return { user, space, role };
}

/**
 * Für Server Actions: ein Aufruf prüft Auth + Space + Recht.
 * Wirft bei fehlendem Zugriff (Action-Kontext, kein Redirect).
 */
export async function authorizeAction(
  form: FormData,
  action: Action,
): Promise<Access> {
  const { user, space, role } = await resolve(str(form, "slug"));
  if (!space || !role || !can(role, action)) {
    throw new Error("Kein Zugriff auf diese Aktion");
  }
  return { user, space, role };
}
