import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/current-user";
import { aiAvailable } from "@/lib/ai";
import { AskForm } from "./AskForm";

export default async function AskPage() {
  await requireUser();
  const available = aiAvailable();

  return (
    <div className="mx-auto max-w-2xl px-6 py-12 animate-[rise_0.4s_ease]">
      <Link
        href="/spaces"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Zurück
      </Link>
      <h1 className="mt-3 flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <Sparkles className="h-5 w-5 text-accent" />
        Frag dein Wiki
      </h1>
      <p className="mt-1.5 text-sm text-muted">
        Stelle Fragen in natürlicher Sprache — die Antwort kommt aus den
        Wiki-Seiten, auf die du Zugriff hast, mit Quellenangaben.
      </p>

      {available ? (
        <AskForm />
      ) : (
        <div className="mt-8 rounded-xl border border-line bg-subtle/60 p-6">
          <h2 className="font-semibold">KI nicht konfiguriert</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Setze <code className="rounded bg-subtle px-1">ANTHROPIC_API_KEY</code>{" "}
            in der Umgebung (z. B. in der <code className="rounded bg-subtle px-1">.env</code>),
            um „Frag dein Wiki" und die KI-Aktionen im Editor zu aktivieren.
            Optional verbessert{" "}
            <code className="rounded bg-subtle px-1">VOYAGE_API_KEY</code> die
            Suche mit semantischen Embeddings — ohne ihn wird die
            Volltextsuche genutzt.
          </p>
        </div>
      )}
    </div>
  );
}
