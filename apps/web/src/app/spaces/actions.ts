"use server";

import { redirect } from "next/navigation";
import { prisma, Prisma } from "@dokunc/db";
import { requireUser } from "@/lib/current-user";
import { slugify } from "@/lib/slug";
import { str } from "@/lib/form";

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
  let created: { slug: string } | null = null;
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
