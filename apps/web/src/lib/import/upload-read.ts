/**
 * Frist fuer das Lesen eines Uploads.
 *
 * Die Route nimmt ihren Import-Platz (global und je Konto), BEVOR sie den
 * Koerper liest: das Lesen und Zerlegen des Formulars ist der Moment, in
 * dem der Upload mehrfach im Speicher liegt, und genau dagegen ist die
 * globale Grenze da. Ohne Frist hielte ein absichtlich langsamer Upload
 * seinen Platz aber so lange, bis Node die Anfrage abbricht (requestTimeout,
 * Default 300 s), und die Takte in lib/import/slots verlaengerten ihn
 * die ganze Zeit.
 *
 * Die Frist waechst mit dem, was ankommt: `graceMs` am Anfang, danach
 * je `minBytesPerSecond` angekommener Bytes eine Sekunde mehr. Wer
 * mindestens so schnell liefert, wird nie abgebrochen, egal wie gross der
 * Upload ist; wer nur tropfenweise liefert, verliert seinen Platz kurz
 * nach `graceMs`. Eine feste Frist haette langsame, aber ehrliche
 * Leitungen bei grossen Exporten abgeschnitten.
 */

export type UploadReadLimits = {
  /** Hoechstens so viele Bytes, danach Abbruch mit "zu-gross". */
  maxBytes: number;
  /** Anfangsfrist, bevor das Mindesttempo zaehlt. */
  graceMs: number;
  /** Mindesttempo im Schnitt ueber den ganzen Upload. */
  minBytesPerSecond: number;
};

/**
 * Werte der Route. 30 s Anlauf, danach im Schnitt mindestens 128 KiB/s
 * (rund 1 Mbit/s). Wer so schnell liefert, stoesst eher an requestTimeout
 * als an diese Frist (100 MB brauchen damit bis zu 830 s); langsamere
 * Leitungen bringen kleine Uploads noch innerhalb des Anlaufs durch. Wer
 * seinen Platz 300 s halten will, muss dafuer rund 34 MB tatsaechlich
 * hochladen, statt ein paar Bytes zu tropfen.
 */
export const UPLOAD_READ_LIMITS = {
  graceMs: 30_000,
  minBytesPerSecond: 128 * 1024,
} as const;

export type UploadStop = "zu-langsam" | "zu-gross";

/**
 * Reicht `source` unveraendert weiter, bricht aber ab, sobald die Frist
 * ablaeuft oder mehr als `maxBytes` ankommen. Dann wird `source`
 * abgebrochen (die Anfrage wird nicht weiter gelesen), der zurueckgegebene
 * Strom endet mit einem Fehler, und `stopped()` nennt den Grund. Alles
 * andere (etwa ein Verbindungsabbruch) kommt als Fehler von `source`
 * durch, mit `stopped()` === null.
 *
 * Als Strom und nicht als fertig gelesene Bytes: so zerlegt die Route das
 * Formular wie bisher mit formData(), und der Upload liegt nicht noch ein
 * weiteres Mal im Speicher. `now` ist die Uhr; ersetzt wird sie nur im
 * Test.
 */
export function guardUpload(
  source: ReadableStream<Uint8Array>,
  limits: UploadReadLimits,
  now: () => number = Date.now,
): { body: ReadableStream<Uint8Array>; stopped: () => UploadStop | null } {
  const reader = source.getReader();
  const start = now();
  let received = 0;
  let stop: UploadStop | null = null;
  // Ein laufender read() ueberlebt eine abgelaufene Wartezeit: wer ihn
  // verwirft und neu liest, verliert den Block, den der alte noch liefert.
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;

  const deadline = () => start + limits.graceMs + (received * 1000) / limits.minBytesPerSecond;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const halt = (why: UploadStop) => {
        stop = why;
        reader.cancel(why).catch(() => undefined);
        controller.error(new Error(`Upload abgebrochen: ${why}`));
      };
      for (;;) {
        const left = deadline() - now();
        if (left <= 0) return halt("zu-langsam");
        pending ??= reader.read();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const step = await Promise.race([
          pending,
          new Promise<null>((resolve) => {
            timer = setTimeout(resolve, Math.min(left, 2 ** 31 - 1), null);
          }),
        ]).finally(() => clearTimeout(timer));
        // Wartezeit um: oben neu rechnen (ein Timer darf etwas zu frueh kommen).
        if (step === null) continue;
        pending = null;
        if (step.done) {
          controller.close();
          return;
        }
        received += step.value.byteLength;
        if (received > limits.maxBytes) return halt("zu-gross");
        controller.enqueue(step.value);
        return;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return { body, stopped: () => stop };
}
