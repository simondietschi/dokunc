import "server-only";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@dokunc/db";
import { requireUser, getMembership } from "@/lib/current-user";

export async function loadSpace(slug: string) {
  const user = await requireUser();
  const space = await prisma.space.findUnique({ where: { slug } });
  if (!space) notFound();

  const role = await getMembership(user.id, space.id);
  if (!role) redirect("/spaces");

  return { user, space, role };
}
