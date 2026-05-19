import "server-only";
import { redirect } from "next/navigation";
import { prisma, type SpaceRole } from "@dokunc/db";
import { getUserId } from "./session";

export async function getCurrentUser() {
  const id = await getUserId();
  if (!id) return null;
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true },
  });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function getMembership(
  userId: string,
  spaceId: string,
): Promise<SpaceRole | null> {
  const m = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId, spaceId } },
    select: { role: true },
  });
  return m?.role ?? null;
}
