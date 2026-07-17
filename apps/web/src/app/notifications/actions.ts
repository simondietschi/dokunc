"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@dokunc/db";
import { requireUser } from "@/lib/current-user";

export async function markAllReadAction() {
  const user = await requireUser();
  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
}
