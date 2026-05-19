"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@dokunc/db";
import { createSession, destroySession } from "@/lib/session";

const registerSchema = z.object({
  name: z.string().min(2, "Name zu kurz"),
  email: z.string().email("Ungültige E-Mail"),
  password: z.string().min(8, "Passwort min. 8 Zeichen"),
});

const loginSchema = z.object({
  email: z.string().email("Ungültige E-Mail"),
  password: z.string().min(1, "Passwort fehlt"),
});

export type ActionState = { error?: string } | undefined;

export async function registerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const { name, email, password } = parsed.data;

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return { error: "E-Mail bereits registriert" };

  const user = await prisma.user.create({
    data: { name, email, passwordHash: await bcrypt.hash(password, 10) },
  });
  await createSession(user.id);
  redirect("/spaces");
}

export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return { error: "Falsche Zugangsdaten" };
  }
  await createSession(user.id);
  redirect("/spaces");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
