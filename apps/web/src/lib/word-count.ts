/** Wörter und Zeichen eines Textes. Rein, damit testbar. */
export function countText(text: string): { words: number; chars: number } {
  const trimmed = text.trim();
  return {
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    chars: text.length,
  };
}
