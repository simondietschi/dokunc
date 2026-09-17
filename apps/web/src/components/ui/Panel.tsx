/**
 * Der Kartenrahmen der Uebersichten: Rand, Flaeche, Schatten und eine
 * Kopfzeile mit Symbol.
 *
 * Er stand zweimal Zeichen fuer Zeichen gleich da, in der Space-Startseite
 * und in den persoenlichen Einstiegen auf /spaces. Wer dort die Kopfzeile
 * anfasste, aenderte nur eine der beiden Karten, und die zweite fiel erst
 * beim Nebeneinanderlegen auf.
 *
 * Gemeinsam ist nur der Rahmen. Die Listen darin sind es nicht: die eine
 * zeigt einen Leertext und verlinkt innerhalb eines Space, die andere
 * blendet sich ganz aus und nennt bei jedem Eintrag dessen Space. Deshalb
 * nimmt `Panel` seinen Inhalt als `children` entgegen, statt beide
 * Bedeutungen in eine Liste zu pressen.
 */
export function Panel({
  title,
  icon,
  style,
  className,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  style?: React.CSSProperties;
  /** Zusaetzliche Klassen fuer das aeussere `section`, z. B. `flex flex-col`. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={`rounded-xl border border-line bg-surface shadow-soft${
        className ? ` ${className}` : ""
      }`}
      style={style}
    >
      <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-[13px] font-semibold text-muted">
        <span className="text-faint">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
