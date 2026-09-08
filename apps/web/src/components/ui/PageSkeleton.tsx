import { Skeleton, SkeletonText } from "./Skeleton";

/** Kopfzeile, wie sie die Voll-Seiten (spaces, admin, konto) rendern. */
export function SkeletonHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-canvas/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <Skeleton className="h-7 w-28" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-[30px] w-[30px] rounded-full" />
        </div>
      </div>
    </header>
  );
}

/** Titel plus Untertitel, wie ihn die Inhaltsseiten oben tragen. */
export function SkeletonTitle({ wide = false }: { wide?: boolean }) {
  return (
    <div>
      <Skeleton className={wide ? "h-9 w-72" : "h-7 w-52"} />
      <Skeleton className="mt-2.5 h-4 w-64" />
    </div>
  );
}

/** Liste aus Karten, für Suchtreffer, Mitglieder, Papierkorb, Verlauf. */
export function SkeletonList({
  rows = 5,
  withAvatar = false,
}: {
  rows?: number;
  withAvatar?: boolean;
}) {
  return (
    <ul className="mt-6 space-y-2.5">
      {Array.from({ length: rows }, (_, i) => (
        <li
          key={i}
          className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4"
        >
          {withAvatar && <Skeleton className="h-8 w-8 rounded-full" />}
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4" style={{ width: `${68 - i * 6}%` }} />
            <Skeleton className="mt-2 h-3" style={{ width: `${44 - i * 4}%` }} />
          </div>
          <Skeleton className="h-8 w-20 shrink-0" />
        </li>
      ))}
    </ul>
  );
}

export { Skeleton, SkeletonText };
