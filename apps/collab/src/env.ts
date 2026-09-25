/**
 * Lädt die Root-.env. MUSS der allererste Import in server.ts sein:
 * ESM evaluiert Imports in Reihenfolge — nur so ist die Umgebung
 * gesetzt, bevor andere Module (z. B. @dokunc/db) sie lesen.
 */
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

// fileURLToPath statt `.pathname`: `.pathname` liefert den
// prozentkodierten URL-Pfad. Läge das Repository in einem Verzeichnis
// mit Leerzeichen oder Umlaut, bekäme dotenv einen Pfad wie
// `/home/u/Mein%20Wiki/.env`, fände die Datei nicht und meldete das
// nicht — der Collab-Server liefe dann ohne Root-.env weiter.
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
