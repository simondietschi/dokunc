import Link from "next/link";
import { prisma } from "@dokunc/db";
import { requireUser } from "@/lib/current-user";
import { logoutAction } from "../(auth)/actions";
import { createSpaceAction } from "./actions";

export default async function SpacesPage() {
  const user = await requireUser();
  const spaces = await prisma.space.findMany({
    where: { members: { some: { userId: user.id } } },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { pages: true } } },
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Deine Spaces</h1>
          <p className="text-sm text-slate-500">{user.name}</p>
        </div>
        <form action={logoutAction}>
          <button className="text-sm text-slate-500 underline">
            Abmelden
          </button>
        </form>
      </header>

      <ul className="space-y-2">
        {spaces.map((s) => (
          <li key={s.id}>
            <Link
              href={`/s/${s.slug}`}
              className="flex items-center justify-between rounded-lg border bg-white px-4 py-3 hover:bg-slate-50"
            >
              <span className="font-medium">{s.name}</span>
              <span className="text-xs text-slate-400">
                {s._count.pages} Seiten
              </span>
            </Link>
          </li>
        ))}
        {spaces.length === 0 && (
          <p className="text-sm text-slate-500">
            Noch keine Spaces — leg unten einen an.
          </p>
        )}
      </ul>

      <form
        action={createSpaceAction}
        className="mt-8 flex gap-2 rounded-lg border bg-white p-4"
      >
        <input
          name="name"
          placeholder="Neuer Space (z.B. Engineering)"
          required
          className="flex-1 rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-slate-400"
        />
        <button className="rounded-lg bg-slate-900 px-4 py-2 text-white">
          Erstellen
        </button>
      </form>
    </div>
  );
}
