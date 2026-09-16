"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, Prisma } from "@dokunc/db";
import { authorizeAction } from "@/lib/space-context";
import { str } from "@/lib/form";
import { spaceSettingsSchema } from "@/lib/space-settings";
import { audit } from "@/lib/audit";
import { deleteSpaceWithUploads } from "@/lib/file-access";
import { revokeCollabAccess } from "@/lib/collab-sync";
import { log } from "@/lib/log";

export type SettingsState = { error?: string; success?: string } | undefined;

const VISIBILITIES = ["PRIVATE", "OPEN"] as const;
const JOIN_ROLES = ["MEMBER", "VIEWER"] as const;

/**
 * Name, Beschreibung, Icon, Sichtbarkeit und Beitrittsrolle aendern
 * (manageSpace). Der Slug bleibt bewusst unangetastet: er steht in jeder
 * gespeicherten URL, in Lesezeichen und in verschickten Links.
 */
export async function updateSpaceAction(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const { space, user } = await authorizeAction(form, "manageSpace");
  const parsed = spaceSettingsSchema.safeParse({
    name: form.get("name") ?? "",
    description: form.get("description") ?? "",
    icon: form.get("icon") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const visibility = str(form, "visibility");
  const joinRole = str(form, "joinRole");

  await prisma.space.update({
    where: { id: space.id },
    data: {
      ...parsed.data,
      // Unbekannte Werte lassen das Feld stehen, statt es zu leeren:
      // die Auswahl kommt aus einem Formular und muss nichts enthalten.
      visibility: (VISIBILITIES as readonly string[]).includes(visibility)
        ? (visibility as (typeof VISIBILITIES)[number])
        : space.visibility,
      joinRole: (JOIN_ROLES as readonly string[]).includes(joinRole)
        ? (joinRole as (typeof JOIN_ROLES)[number])
        : space.joinRole,
    },
  });
  await audit({
    action: "space.updated",
    actorId: user.id,
    spaceId: space.id,
    metadata: { name: parsed.data.name, visibility, joinRole },
  });
  revalidatePath(`/s/${space.slug}`, "layout");
  revalidatePath("/spaces");
  return { success: "Einstellungen gespeichert." };
}

/**
 * Space endgueltig loeschen — nur OWNER, Bestaetigung durch Eintippen
 * des Namens. Uploads der Anhaenge werden best effort von der Platte
 * entfernt (die Datensaetze fallen per Kaskade).
 */
export async function deleteSpaceAction(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const { space, role, user } = await authorizeAction(form, "manageSpace");
  if (role !== "OWNER") return { error: "Nur Owner können den Space löschen." };
  if (str(form, "confirm") !== space.name) {
    return { error: "Der eingegebene Name stimmt nicht mit dem Space-Namen überein." };
  }

  await deleteSpaceWithUploads(space.id);
  log.info({ spaceId: space.id, userId: user.id }, "Space gelöscht");

  revalidatePath("/spaces");
  redirect("/spaces");
}

/**
 * Bricht die Austritts-Transaktion ab, ohne als 500 nach aussen zu gehen:
 * der Aufrufer macht daraus eine Meldung im Formular.
 */
class LastOwnerError extends Error {}

/**
 * Eigene Mitgliedschaft beenden (alle Rollen). Der letzte OWNER kann
 * den Space nicht verlassen — sonst bliebe er ohne Verwaltung zurueck.
 */
export async function leaveSpaceAction(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const { space, role, user } = await authorizeAction(form, "read");
  try {
    await prisma.$transaction(
      async (tx) => {
        if (role === "OWNER") {
          // Nur Owner mit aktivem Konto zaehlen — ein gesperrtes Konto kann
          // den Space nicht verwalten.
          const owners = await tx.spaceMember.count({
            where: {
              spaceId: space.id,
              role: "OWNER",
              user: { isActive: true },
            },
          });
          if (owners <= 1) throw new LastOwnerError();
        }
        await tx.spaceMember.deleteMany({
          where: { spaceId: space.id, userId: user.id },
        });
      },
      // Serializable: sonst zaehlen zwei gleichzeitig austretende Owner
      // beide zwei, beide loeschen, und der Space bleibt ohne Eigentuemer
      // zurueck — genau der Zustand, den die Pruefung verhindern soll.
      { isolationLevel: "Serializable" },
    );
  } catch (e) {
    if (e instanceof LastOwnerError) {
      return {
        error:
          "Du bist der letzte Owner. Ernenne zuerst eine andere Person zum Owner oder lösche den Space.",
      };
    }
    // Serialisierungskonflikt (P2034): eine parallele Aenderung am selben
    // Space hat gewonnen. Ein neuer Versuch sieht den aktuellen Stand.
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2034"
    ) {
      return {
        error:
          "Der Space wurde gleichzeitig geändert. Bitte noch einmal versuchen.",
      };
    }
    throw e;
  }
  await revokeCollabAccess(user.id, space.id);
  revalidatePath("/spaces");
  redirect("/spaces");
}
