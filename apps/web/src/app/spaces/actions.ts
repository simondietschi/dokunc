"use server";

import { redirect } from "next/navigation";
import { prisma } from "@dokunc/db";
import { requireUser } from "@/lib/current-user";
import { slugify } from "@/lib/slug";
import { str } from "@/lib/form";

export async function createSpaceAction(formData: FormData) {
  const user = await requireUser();
  const name = str(formData, "name");
  if (name.length < 2) return;

  let slug = slugify(name);
  if (await prisma.space.findUnique({ where: { slug } })) {
    slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const space = await prisma.space.create({
    data: {
      name,
      slug,
      members: { create: { userId: user.id, role: "OWNER" } },
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
  redirect(`/s/${space.slug}`);
}
