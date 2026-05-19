"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@dokunc/db";
import { requireUser } from "@/lib/current-user";
import { createSession, destroySession } from "@/lib/session";
import { str } from "@/lib/form";

export type AccountState = { error?: string; success?: string } | undefined;

export async function updateProfileAction(
  _prev: AccountState,
  form: FormData,
): Promise<AccountState> {
  const user = await requireUser();
  const name = str(form, "name");
  if (name.length < 2) return { error: "Name zu kurz" };
  await prisma.user.update({ where: { id: user.id }, data: { name } });
  revalidatePath("/account");
  return { success: "Profil aktualisiert." };
}

const pwSchema = z.object({
  current: z.string().min(1, "Aktuelles Passwort fehlt"),
  next: z.string().min(8, "Neues Passwort min. 8 Zeichen"),
});

export async function changePasswordAction(
  _prev: AccountState,
  form: FormData,
): Promise<AccountState> {
  const sessionUser = await requireUser();
  const parsed = pwSchema.safeParse({
    current: form.get("current"),
    next: form.get("next"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const dbUser = await prisma.user.findUnique({
    where: { id: sessionUser.id },
  });
  if (
    !dbUser ||
    !(await bcrypt.compare(parsed.data.current, dbUser.passwordHash))
  ) {
    return { error: "Aktuelles Passwort ist falsch." };
  }

  // Passwort setzen + alle bestehenden Sessions entwerten.
  const updated = await prisma.user.update({
    where: { id: dbUser.id },
    data: {
      passwordHash: await bcrypt.hash(parsed.data.next, 10),
      tokenVersion: { increment: 1 },
    },
  });
  // Aktuelles Gerät frisch einloggen (neue Token-Version).
  await createSession(updated.id, updated.tokenVersion);
  return { success: "Passwort geändert. Andere Sitzungen wurden beendet." };
}

export async function logoutEverywhereAction() {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { tokenVersion: { increment: 1 } },
  });
  await destroySession();
  redirect("/login");
}
