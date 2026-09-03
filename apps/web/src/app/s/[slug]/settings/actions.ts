"use server";

import { unlink } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { authorizeAction } from "@/lib/space-context";
import { str } from "@/lib/form";
import { spaceSettingsSchema } from "@/lib/space-settings";
import { UPLOAD_DIR, isSafeFilename } from "@/lib/uploads";
import { log } from "@/lib/log";

export type SettingsState = { error?: string; success?: string } | undefined;

/** Name, Beschreibung und Icon des Space aendern (manageSpace). */
export async function updateSpaceAction(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const { space } = await authorizeAction(form, "manageSpace");
  const parsed = spaceSettingsSchema.safeParse({
    name: form.get("name") ?? "",
    description: form.get("description") ?? "",
    icon: form.get("icon") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await prisma.space.update({
    where: { id: space.id },
    data: parsed.data,
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
  if (role !== "OWNER") return { error: "Nur Owner koennen den Space loeschen." };
  if (str(form, "confirm") !== space.name) {
    return { error: "Der eingegebene Name stimmt nicht mit dem Space-Namen ueberein." };
  }

  const attachments = await prisma.attachment.findMany({
    where: { spaceId: space.id },
    select: { storedName: true },
  });
  await prisma.space.delete({ where: { id: space.id } });
  log.info({ spaceId: space.id, userId: user.id }, "Space geloescht");

  const base = path.resolve(UPLOAD_DIR);
  await Promise.all(
    attachments
      .filter((a) => isSafeFilename(a.storedName))
      .map((a) => unlink(path.join(base, a.storedName)).catch(() => undefined)),
  );

  revalidatePath("/spaces");
  redirect("/spaces");
}

/**
 * Eigene Mitgliedschaft beenden (alle Rollen). Der letzte OWNER kann
 * den Space nicht verlassen — sonst bliebe er ohne Verwaltung zurueck.
 */
export async function leaveSpaceAction(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const { space, role, user } = await authorizeAction(form, "read");
  if (role === "OWNER") {
    const owners = await prisma.spaceMember.count({
      where: { spaceId: space.id, role: "OWNER" },
    });
    if (owners <= 1) {
      return {
        error:
          "Du bist der letzte Owner. Ernenne zuerst eine andere Person zum Owner oder loesche den Space.",
      };
    }
  }
  await prisma.spaceMember.deleteMany({
    where: { spaceId: space.id, userId: user.id },
  });
  revalidatePath("/spaces");
  redirect("/spaces");
}
