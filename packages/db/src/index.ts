import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Lazy-Initialisierung: Der Client wird erst beim ersten Zugriff gebaut,
 * NICHT beim Import. Sonst bricht jeder Prozess, der .env nach dem
 * Import lädt (ESM hoisted Imports vor den Modul-Body).
 */
function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL ist nicht gesetzt. .env laden BEVOR @dokunc/db verwendet wird.",
    );
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
    log: process.env.DEBUG_DB ? ["query", "error", "warn"] : ["error"],
  });
}

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }
  return globalForPrisma.prisma;
}

/**
 * Proxy, damit `prisma.user.findUnique(...)` überall unverändert
 * funktioniert, die echte Instanz aber erst bei der ersten Nutzung
 * entsteht (mit dann vollständig geladener Umgebung).
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient() as unknown as Record<PropertyKey, unknown>;
    const value = client[prop];
    return typeof value === "function"
      ? (value as (...a: unknown[]) => unknown).bind(client)
      : value;
  },
});

export * from "./generated/prisma/client";
