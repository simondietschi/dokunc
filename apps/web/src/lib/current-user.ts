import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@dokunc/db";
import { getSessionClaims } from "./session";

/**
 * Liefert den angemeldeten Nutzer — nur wenn das Konto aktiv ist UND
 * die Token-Version stimmt (Session-Revocation: Passwortwechsel /
 * "überall abmelden" erhöhen tokenVersion und entwerten alte JWTs).
 */
export async function getCurrentUser() {
  const claims = await getSessionClaims();
  if (!claims) return null;
  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: {
      id: true,
      email: true,
      name: true,
      isAdmin: true,
      isActive: true,
      tokenVersion: true,
    },
  });
  if (!user || !user.isActive || user.tokenVersion !== claims.tv) {
    return null;
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin,
  };
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/spaces");
  return user;
}
