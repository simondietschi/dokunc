"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Hört auf neue Benachrichtigungen und frischt die Serverseite auf.
 *
 * Bewusst nur ein Auslöser für `router.refresh()`: der Zähler an der
 * Glocke und die Kommentarliste kommen ohnehin vom Server, sie brauchen
 * keinen zweiten Zustand im Client, der auseinanderlaufen könnte.
 */
export function NotificationStream() {
  const router = useRouter();

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/notifications/stream");
    const onNotification = () => router.refresh();
    source.addEventListener("notification", onNotification);
    return () => {
      source.removeEventListener("notification", onNotification);
      source.close();
    };
  }, [router]);

  return null;
}
