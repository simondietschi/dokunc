import { z } from "zod";

/**
 * Validierung der Space-Einstellungen (Name, Beschreibung, Emoji-Icon).
 * Wird von der Server Action und (fuer die Schnellauswahl) vom Client
 * genutzt — deshalb ohne "server-only".
 */

export const SPACE_NAME_MIN = 2;
export const SPACE_NAME_MAX = 80;
export const SPACE_DESCRIPTION_MAX = 300;
/** Ein Emoji besteht aus bis zu 4 Codepoints (Modifier, ZWJ, Variation). */
export const SPACE_ICON_MAX_CODEPOINTS = 4;

/** Schnellauswahl fuer das Space-Icon. */
export const QUICK_ICONS = [
  "📘",
  "📗",
  "📙",
  "🧭",
  "🛠️",
  "🚀",
  "💡",
  "🧪",
  "📊",
  "🗂️",
  "🏠",
  "🎯",
] as const;

/**
 * Gueltiges Icon: 1 bis 4 Codepoints, kein ASCII (Buchstaben, Ziffern,
 * Markup-Zeichen wie "<"), kein Leerraum, keine Steuerzeichen, und
 * mindestens ein Emoji-/Symbolzeichen. Absichtlich keine harte
 * Emoji-Liste (Unicode waechst), aber Text als "Icon" ist ausgeschlossen.
 */
export function isValidIcon(icon: string): boolean {
  const points = [...icon];
  if (points.length === 0 || points.length > SPACE_ICON_MAX_CODEPOINTS) return false;
  if (/[\s\p{Cc}]/u.test(icon)) return false;
  // Keycap-Emoji ("1\uFE0F\u20E3", "#\uFE0F\u20E3") sind die einzigen mit ASCII-Anteil.
  const withoutKeycaps = icon.replace(/[0-9#*]\uFE0F?\u20E3/g, "");
  if (/[\x00-\x7f]/.test(withoutKeycaps)) return false;
  return /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator}|\p{So}|\u20E3/u.test(
    icon,
  );
}

export const spaceSettingsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(SPACE_NAME_MIN, `Name muss mindestens ${SPACE_NAME_MIN} Zeichen haben`)
    .max(SPACE_NAME_MAX, `Name darf höchstens ${SPACE_NAME_MAX} Zeichen haben`),
  description: z
    .string()
    .trim()
    .max(
      SPACE_DESCRIPTION_MAX,
      `Beschreibung darf höchstens ${SPACE_DESCRIPTION_MAX} Zeichen haben`,
    )
    .transform((s) => s || null),
  icon: z
    .string()
    .trim()
    .transform((s) => s || null)
    .refine((s) => s === null || isValidIcon(s), "Icon muss ein einzelnes Emoji sein"),
});

export type SpaceSettings = z.infer<typeof spaceSettingsSchema>;
