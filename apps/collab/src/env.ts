/**
 * Lädt die Root-.env. MUSS der allererste Import in server.ts sein:
 * ESM evaluiert Imports in Reihenfolge — nur so ist die Umgebung
 * gesetzt, bevor andere Module (z. B. @dokunc/db) sie lesen.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: new URL("../../../.env", import.meta.url).pathname });
