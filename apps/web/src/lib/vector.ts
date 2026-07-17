/** Float32-Vektor <-> Bytes (Prisma Bytes-Spalte) + Kosinus-Ähnlichkeit. */

export function vectorToBytes(v: number[]): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(v.length * 4);
  new Float32Array(buf).set(v);
  return new Uint8Array(buf);
}

export function bytesToVector(b: Uint8Array): Float32Array {
  // Kopie, damit Alignment/Offset der Quelle egal sind.
  const buf = new ArrayBuffer(b.byteLength);
  new Uint8Array(buf).set(b);
  return new Float32Array(buf);
}

export function cosineSimilarity(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
