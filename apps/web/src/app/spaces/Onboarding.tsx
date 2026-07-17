"use client";

import { useState } from "react";
import { FolderPlus, Users, PenLine, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { createSpaceAction } from "./actions";

const SUGGESTIONS = ["Engineering", "Produkt", "Team-Handbuch", "Wissen"];

const STEPS = [
  {
    icon: FolderPlus,
    title: "Space anlegen",
    text: "Ein Bereich pro Team oder Projekt.",
  },
  {
    icon: Users,
    title: "Team einladen",
    text: "Per E-Mail — sicher und tokenbasiert.",
  },
  {
    icon: PenLine,
    title: "Gemeinsam schreiben",
    text: "In Echtzeit, mit Live-Cursorn.",
  },
];

function stagger(i: number): React.CSSProperties {
  return {
    animation: "rise 0.5s cubic-bezier(0.22,1,0.36,1) both",
    animationDelay: `${80 + i * 90}ms`,
  };
}

/** Erster Login, noch keine Spaces: Willkommens-Onboarding. */
export function Onboarding({ userName }: { userName: string }) {
  const [name, setName] = useState("");
  const firstName = userName.split(" ")[0] || userName;

  return (
    <div className="mx-auto max-w-2xl px-6 pb-24 pt-16 text-center">
      <div
        className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-accent to-violet-500 shadow-pop"
        style={stagger(0)}
      >
        <span className="h-5 w-5 rounded-[5px] bg-white/95" />
      </div>

      <h1
        className="mt-6 text-3xl font-semibold tracking-tight"
        style={stagger(1)}
      >
        Willkommen, {firstName}!
      </h1>
      <p
        className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-muted"
        style={stagger(2)}
      >
        dokunc ist startklar. Leg deinen ersten Space an — den Bereich,
        in dem dein Team Wissen sammelt und gemeinsam schreibt.
      </p>

      {/* Schritte */}
      <div
        className="mx-auto mt-10 grid max-w-xl gap-3 sm:grid-cols-3"
        style={stagger(3)}
      >
        {STEPS.map(({ icon: Icon, title, text }, i) => (
          <div
            key={title}
            className="relative rounded-xl border border-line bg-surface p-4 text-left shadow-soft"
          >
            <span className="absolute right-3 top-3 text-[11px] font-semibold text-faint">
              {i + 1}
            </span>
            <Icon className="h-5 w-5 text-accent" />
            <p className="mt-2.5 text-[13.5px] font-semibold">{title}</p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-muted">
              {text}
            </p>
          </div>
        ))}
      </div>

      {/* Space anlegen */}
      <form
        action={createSpaceAction}
        className="mx-auto mt-10 max-w-md"
        style={stagger(4)}
      >
        <div className="flex gap-2">
          <Input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name deines ersten Space…"
            autoFocus
            required
            className="h-12 flex-1 text-[15px]"
          />
          <Button type="submit" size="lg">
            Space erstellen
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className="text-[12px] text-faint">Vorschläge:</span>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setName(s)}
              className="rounded-full border border-line-strong bg-surface px-3 py-1 text-[12.5px] text-muted transition-colors hover:border-accent/50 hover:text-ink"
            >
              {s}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}

/** Eingeladene Person ohne Space-Mitgliedschaft. */
export function WaitingForInvite() {
  return (
    <div className="mx-auto max-w-md px-6 pb-24 pt-20 text-center">
      <div
        className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-line bg-subtle"
        style={stagger(0)}
      >
        <Users className="h-5 w-5 text-faint" />
      </div>
      <h1
        className="mt-5 text-2xl font-semibold tracking-tight"
        style={stagger(1)}
      >
        Noch kein Space
      </h1>
      <p
        className="mt-2 text-sm leading-relaxed text-muted"
        style={stagger(2)}
      >
        Du bist noch keinem Space zugeordnet. Bitte eine Admin-Person,
        dich in einen Space einzuladen — die Einladung kommt per E-Mail.
      </p>

      <div
        className="mt-8 flex items-center gap-3 text-[11px] uppercase tracking-wider text-faint"
        style={stagger(3)}
      >
        <span className="h-px flex-1 bg-line" />
        oder
        <span className="h-px flex-1 bg-line" />
      </div>
      <form
        action={createSpaceAction}
        className="mt-4 flex gap-2"
        style={stagger(4)}
      >
        <Input
          name="name"
          placeholder="Eigenen Space starten…"
          required
          className="h-11 flex-1"
        />
        <Button type="submit">Space erstellen</Button>
      </form>
    </div>
  );
}
