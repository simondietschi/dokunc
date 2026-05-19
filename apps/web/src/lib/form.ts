/** FormData-Feld als getrimmter String (nie undefined). */
export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Optionaler String – leeres Feld wird zu null. */
export function strOrNull(form: FormData, key: string): string | null {
  return str(form, key) || null;
}
