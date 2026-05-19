import { config as loadEnv } from "dotenv";
loadEnv({ path: new URL("../../../.env", import.meta.url).pathname });

import { Server } from "@hocuspocus/server";
import { TiptapTransformer } from "@hocuspocus/transformer";
import { jwtVerify } from "jose";
import * as Y from "yjs";
import { prisma } from "@dokunc/db";
import { baseExtensions, COLLAB_FIELD } from "@dokunc/editor";

const PORT = Number(process.env.COLLAB_PORT ?? 3001);
const SECRET = new TextEncoder().encode(
  process.env.APP_SECRET ?? "change-me-please-change-me-please-32+",
);
const extensions = baseExtensions();

/** Mindestabstand zwischen History-Snapshots pro Seite (ms). */
const VERSION_INTERVAL_MS = 2 * 60 * 1000;
const lastVersionAt = new Map<string, number>();

async function authorize(token: string | undefined, pageId: string) {
  if (!token) throw new Error("Kein Token");
  const { payload } = await jwtVerify(token, SECRET);
  const userId = String(payload.sub);

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { spaceId: true },
  });
  if (!page) throw new Error("Seite nicht gefunden");

  const member = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId, spaceId: page.spaceId } },
    select: { role: true },
  });
  if (!member) throw new Error("Kein Zugriff auf diesen Space");

  const readOnly = member.role === "VIEWER";
  return { userId, readOnly };
}

const server = new Server({
  port: PORT,
  async onAuthenticate(data) {
    const { userId, readOnly } = await authorize(
      data.token,
      data.documentName,
    );
    data.connection.readOnly = readOnly;
    return { userId };
  },

  async onLoadDocument(data) {
    const pageId = data.documentName;
    const existing = await prisma.collabDocument.findUnique({
      where: { pageId },
    });

    if (existing) {
      Y.applyUpdate(data.document, new Uint8Array(existing.state));
      return data.document;
    }

    // Erstes Öffnen: aus gespeichertem Page-Content seeden.
    const page = await prisma.page.findUnique({
      where: { id: pageId },
      select: { content: true },
    });
    if (page?.content) {
      const seeded = TiptapTransformer.toYdoc(
        page.content,
        COLLAB_FIELD,
        extensions,
      );
      Y.applyUpdate(data.document, Y.encodeStateAsUpdate(seeded));
    }
    return data.document;
  },

  async onStoreDocument(data) {
    const pageId = data.documentName;
    const state = Buffer.from(Y.encodeStateAsUpdate(data.document));

    const json = TiptapTransformer.fromYdoc(data.document, COLLAB_FIELD);
    const textContent = extractText(json);

    await prisma.$transaction([
      prisma.collabDocument.upsert({
        where: { pageId },
        create: { pageId, state },
        update: { state },
      }),
      prisma.page.update({
        where: { id: pageId },
        data: { content: json, textContent },
      }),
    ]);

    const now = Date.now();
    const last = lastVersionAt.get(pageId) ?? 0;
    if (now - last > VERSION_INTERVAL_MS) {
      lastVersionAt.set(pageId, now);
      const page = await prisma.page.findUnique({
        where: { id: pageId },
        select: { title: true },
      });
      const userId =
        (data.context?.userId as string | undefined) ?? undefined;
      await prisma.pageVersion.create({
        data: {
          pageId,
          title: page?.title ?? "Untitled",
          content: json,
          textContent,
          authorId: userId,
        },
      });
    }
  },
});

/** Plain-Text aus ProseMirror-JSON ziehen (für Suche/History). */
function extractText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text" && typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) {
    return n.content.map(extractText).join(" ");
  }
  return "";
}

server.listen().then(() => {
  // eslint-disable-next-line no-console
  console.log(`[collab] Hocuspocus läuft auf ws://localhost:${PORT}`);
});
