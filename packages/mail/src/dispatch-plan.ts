import type { NotificationMailItem } from "./notifications";

/**
 * Reine Planungslogik für den Mail-Versand von Benachrichtigungen.
 * Der Dispatcher (Collab-Prozess) lädt offene Einträge, lässt sie hier
 * einteilen und führt anschliessend nur noch aus. Ohne I/O, damit die
 * Regeln vollständig per Unit-Test abgedeckt sind.
 */

export type EmailMode = "INSTANT" | "DAILY" | "OFF";

export type DispatchCandidate = {
  id: string;
  userId: string;
  createdAt: Date;
  readAt: Date | null;
  user: {
    email: string;
    name: string;
    isActive: boolean;
    emailNotifications: EmailMode;
  };
  /** Bereits aufgelöster Inhalt für die Mail (Akteur, Seite, Link). */
  item: NotificationMailItem;
};

export type DispatchBatch = {
  userId: string;
  email: string;
  name: string;
  /** Vorlage: Sofort-Mail oder Tageszusammenfassung. */
  mode: "INSTANT" | "DAILY";
  notificationIds: string[];
  items: NotificationMailItem[];
};

export type DispatchPlan = {
  /** Zu versendende Mails, eine pro Nutzer. */
  send: DispatchBatch[];
  /** Nur als erledigt markieren (keine Mail): aus, inaktiv oder gelesen. */
  markOnly: string[];
};

/** Sammelfenster: Einträge müssen mindestens so alt sein (ms). */
export const INSTANT_BATCH_WINDOW_MS = 20_000;

export function planDispatch(
  candidates: DispatchCandidate[],
  now: Date,
  opts: { digest: boolean; batchWindowMs?: number },
): DispatchPlan {
  const windowMs = opts.batchWindowMs ?? INSTANT_BATCH_WINDOW_MS;
  const cutoff = now.getTime() - windowMs;
  const markOnly: string[] = [];
  const groups = new Map<string, DispatchBatch>();

  // Stabile Reihenfolge innerhalb einer Mail: älteste zuerst.
  const ordered = [...candidates].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  for (const c of ordered) {
    const mode = c.user.emailNotifications;
    if (mode === "OFF" || !c.user.isActive || c.readAt) {
      markOnly.push(c.id);
      continue;
    }
    if (mode === "INSTANT" && c.createdAt.getTime() > cutoff) {
      // Noch im Sammelfenster: nächster Lauf.
      continue;
    }
    if (mode === "DAILY" && !opts.digest) {
      // Wartet auf den Digest-Lauf.
      continue;
    }

    const key = `${mode}:${c.userId}`;
    let batch = groups.get(key);
    if (!batch) {
      batch = {
        userId: c.userId,
        email: c.user.email,
        name: c.user.name,
        mode,
        notificationIds: [],
        items: [],
      };
      groups.set(key, batch);
    }
    batch.notificationIds.push(c.id);
    batch.items.push(c.item);
  }

  return { send: [...groups.values()], markOnly };
}
