"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, Prisma } from "@dokunc/db";
import { requireUser } from "@/lib/current-user";
import { slugify } from "@/lib/slug";
import { str, strOrNull } from "@/lib/form";
import { audit } from "@/lib/audit";
import { authorizeAction } from "@/lib/space-context";
import { revokeCollabAccess } from "@/lib/collab-sync";

export async function createSpaceAction(formData: FormData) {
  const user = await requireUser();
  const name = str(formData, "name");
  if (name.length < 2) return;

  // Der Slug ist unique. Ein Vorab-Check allein reicht nicht: zwei
  // gleichzeitige Anlagen sehen beide "frei" und die zweite scheitert am
  // Constraint (bisher ein 500). Deshalb im Kreis versuchen und nur bei
  // genau diesem Constraint einen neuen Namen ziehen.
  const base = slugify(name);
  let slug = base;
  let created: { id: string; slug: string } | null = null;
  for (let attempt = 0; attempt < 6 && !created; attempt++) {
    if (attempt > 0 || (await prisma.space.findUnique({ where: { slug } }))) {
      slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    }
    try {
      created = await createSpace(user.id, name, slug);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        continue;
      }
      throw e;
    }
  }
  if (!created) {
    throw new Error("Space konnte nicht angelegt werden (Slug belegt).");
  }
  await audit({
    action: "space.created",
    actorId: user.id,
    spaceId: created.id,
    metadata: { name, slug: created.slug },
  });
  // redirect() wirft intern — deshalb ausserhalb des try/catch.
  redirect(`/s/${created.slug}`);
}

function createSpace(userId: string, name: string, slug: string) {
  return prisma.space.create({
    data: {
      name,
      slug,
      members: { create: { userId, role: "OWNER" } },
      pages: {
        create: {
          title: "Willkommen",
          textContent: "Willkommen in diesem Space.",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Willkommen in diesem Space." },
                ],
              },
            ],
          },
        },
      },
    },
  });
}

const VISIBILITIES = ["PRIVATE", "OPEN"] as const;
const JOIN_ROLES = ["MEMBER", "VIEWER"] as const;

/**
 * Space umbenennen und Sichtbarkeit setzen.
 *
 * Der Slug bleibt bewusst unangetastet: er steht in jeder gespeicherten
 * URL, in Lesezeichen und in verschickten Links. Ein Space ohne
 * Umbenennen war aber genauso falsch — `rg "space.update"` fand vorher
 * keinen einzigen Treffer.
 */
export async function updateSpaceAction(form: FormData) {
  const { space, user } = await authorizeAction(form, "manageSpace");
  const name = str(form, "name");
  if (name.length < 2) return;

  const visibility = str(form, "visibility");
  const joinRole = str(form, "joinRole");

  await prisma.space.update({
    where: { id: space.id },
    data: {
      name,
      description: strOrNull(form, "description"),
      visibility: (VISIBILITIES as readonly string[]).includes(visibility)
        ? (visibility as "PRIVATE" | "OPEN")
        : space.visibility,
      joinRole: (JOIN_ROLES as readonly string[]).includes(joinRole)
        ? (joinRole as "MEMBER" | "VIEWER")
        : space.joinRole,
    },
  });
  await audit({
    action: "space.updated",
    actorId: user.id,
    spaceId: space.id,
    metadata: { name, visibility, joinRole },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
  revalidatePath("/spaces");
}

/**
 * Space verlassen.
 *
 * Über die Mitgliederverwaltung geht das absichtlich nicht (dort wäre
 * es ein Versehen); hier ist es eine bewusste eigene Entscheidung. Der
 * letzte Eigentümer bleibt trotzdem, sonst stünde der Space ohne
 * Verwaltung da.
 */
export async function leaveSpaceAction(form: FormData) {
  const { space, user, role } = await authorizeAction(form, "read");
  // Nur aktive Konten zaehlen — ein gesperrtes OWNER-Konto kann den
  // Space nicht mehr verwalten und darf den letzten aktiven Eigentuemer
  // deshalb nicht freigeben.
  const ownerCount = await prisma.spaceMember.count({
    where: { spaceId: space.id, role: "OWNER", user: { isActive: true } },
  });
  if (role === "OWNER" && ownerCount <= 1) return;

  await prisma.spaceMember.deleteMany({
    where: { spaceId: space.id, userId: user.id },
  });
  await audit({
    action: "space.left",
    actorId: user.id,
    spaceId: space.id,
    metadata: { role },
  });
  // Offene Editor-Sitzungen trennen: die Rechte werden nur beim
  // Verbinden geprueft, sonst schreibt man nach dem Austritt weiter.
  await revokeCollabAccess(user.id, space.id);
  revalidatePath("/spaces");
  redirect("/spaces");
}

/** Einem offenen Space beitreten. */
export async function joinSpaceAction(form: FormData) {
  const user = await requireUser();
  const spaceId = str(form, "spaceId");

  const space = await prisma.space.findFirst({
    // Nur offene Spaces: die ID kommt aus dem Formular.
    where: { id: spaceId, visibility: "OPEN" },
    select: { id: true, slug: true, joinRole: true },
  });
  if (!space) redirect("/spaces");

  await prisma.spaceMember.upsert({
    where: { userId_spaceId: { userId: user.id, spaceId: space.id } },
    create: { userId: user.id, spaceId: space.id, role: space.joinRole },
    update: {},
  });
  await audit({
    action: "space.joined",
    actorId: user.id,
    spaceId: space.id,
    metadata: { role: space.joinRole },
  });
  revalidatePath("/spaces");
  redirect(`/s/${space.slug}`);
}
