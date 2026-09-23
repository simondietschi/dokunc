"use client";

import { useActionState, useState } from "react";
import {
  Check,
  Copy,
  Download,
  Loader2,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import {
  cancelTotpSetupAction,
  confirmRecoveryCodesAction,
  confirmTotpAction,
  disableTotpAction,
  discardRecoveryCodesAction,
  regenerateRecoveryCodesAction,
  startTotpSetupAction,
  type TotpState,
} from "./totp-actions";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

function Status({ state }: { state: TotpState }) {
  if (state?.error)
    return (
      <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
        {state.error}
      </p>
    );
  if (state?.success)
    return (
      <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-600">
        {state.success}
      </p>
    );
  return null;
}

/**
 * Die Codes stehen genau einmal im Klartext da — danach liegt in der
 * Datenbank nur der Hash. Deshalb Kopieren und Herunterladen direkt
 * daneben.
 */
function RecoveryCodes({ codes }: { codes: string[] }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Kopieren nicht möglich",
        description: "Markiere die Codes und kopiere sie von Hand.",
        variant: "error",
      });
    }
  }

  function download() {
    const url = URL.createObjectURL(
      new Blob([`${text}\n`], { type: "text/plain" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "dokunc-wiederherstellungscodes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
      <h3 className="text-[13px] font-semibold">Wiederherstellungscodes</h3>
      <p className="mt-1 text-[12.5px] text-muted">
        Bewahre sie ausserhalb deines Telefons auf. Jeder Code gilt einmal
        und ersetzt den Authenticator, wenn du keinen Zugriff mehr hast.
        Sie werden dir nur jetzt angezeigt.
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[13px]">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Kopiert" : "Kopieren"}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={download}>
          <Download className="h-3.5 w-3.5" />
          Herunterladen
        </Button>
      </div>
    </div>
  );
}

/** Frisch ausgegebene Codes, die noch auf ihre Bestätigung warten. */
type PendingCodes = { codes: string[]; minutes: number };

/** Ersatzwert, falls die Aktion keine Frist mitschickt. */
const FALLBACK_MINUTES = 30;

/**
 * Codes zeigen und einen davon zurück eintippen lassen.
 *
 * Erst das Eintippen macht die Codes gültig (bei der Einrichtung auch
 * den zweiten Faktor). Es beweist, dass die Liste die Person erreicht
 * hat — ging die Antwort unterwegs verloren, bleibt alles, wie es war,
 * statt ein Konto ohne brauchbaren Wiederherstellungscode zu hinterlassen.
 *
 * Exportiert nur fuer den Integrationstest, der prueft, welche Felder
 * das Formular mitschickt (totp-actions.test.ts).
 */
export function ConfirmCodes({
  pending,
  renewing,
  onConfirmed,
  onCancel,
}: {
  pending: PendingCodes;
  renewing: boolean;
  onConfirmed: (message: string) => void;
  onCancel: () => void;
}) {
  const [state, action, busy] = useActionState<TotpState, FormData>(
    async (prev, form) => {
      const next = await confirmRecoveryCodesAction(prev, form);
      // Nach der Bestätigung verschwinden Liste und Formular; die Meldung
      // muss deshalb oben liegen.
      if (next?.confirmed) {
        onConfirmed(next.success ?? "Gespeichert.");
      }
      return next;
    },
    undefined,
  );

  return (
    <div className="space-y-4">
      <RecoveryCodes codes={pending.codes} />
      <form action={action} className="space-y-3">
        {/* Nur für den Text der Meldung: sie soll den Knopf nennen, den
            diese Ansicht wirklich hat. Geprüft wird damit nichts. */}
        <input type="hidden" name="mode" value={renewing ? "renew" : "setup"} />
        <p className="text-[12.5px] text-muted">
          {renewing
            ? "Die bisherigen Codes gelten weiter, bis du hier einen der neuen eintippst. "
            : "Der zweite Faktor wird erst aktiv, wenn du hier einen der Codes eintippst — so ist sicher, dass du sie hast. "}
          Ohne Bestätigung verfallen die neuen Codes nach {pending.minutes}{" "}
          Minuten.
        </p>
        <Field label="Einer der Codes zur Bestätigung">
          <Input
            name="code"
            autoComplete="off"
            spellCheck={false}
            placeholder="xxxxxxxxxx-xxxxxxxxxx"
            required
            className="font-mono"
          />
        </Field>
        <Status state={state} />
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : renewing ? (
              "Bestätigen"
            ) : (
              "Aktivieren"
            )}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {renewing ? "Verwerfen" : "Abbrechen"}
          </Button>
        </div>
      </form>
    </div>
  );
}

type Setup = NonNullable<NonNullable<TotpState>["setup"]>;

/**
 * Schritt 2 der Einrichtung: QR zeigen, Code prüfen. Scharf ist danach
 * noch nichts — erst folgen die Wiederherstellungscodes (`ConfirmCodes`).
 */
function SetupSteps({
  setup,
  onCodes,
  onCancel,
}: {
  setup: Setup;
  onCodes: (pending: PendingCodes) => void;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState<TotpState, FormData>(
    async (prev, form) => {
      const next = await confirmTotpAction(prev, form);
      // Die Codes wandern nach oben: an ihrer Stelle verschwindet dieser
      // Schritt mitsamt seinem Zustand.
      if (next?.recoveryCodes) {
        onCodes({
          codes: next.recoveryCodes,
          minutes: next.confirmMinutes ?? FALLBACK_MINUTES,
        });
      }
      return next;
    },
    undefined,
  );

  return (
    <div className="mt-4 space-y-4">
      <ol className="space-y-4 text-[13px]">
        <li>
          <p className="font-medium">1. Konto in der App hinzufügen</p>
          <p className="mt-0.5 text-muted">
            Scanne den Code mit einer Authenticator-App (etwa Aegis,
            1Password, Google Authenticator).
          </p>
          {setup.qr && (
            <div
              className="mt-3 w-[200px] rounded-lg bg-white p-2 [&_svg]:h-auto [&_svg]:w-full"
              // Markup aus der eigenen QR-Bibliothek über den selbst
              // gebauten otpauth-Text — keine Fremdeingabe.
              dangerouslySetInnerHTML={{ __html: setup.qr }}
            />
          )}
          <p className="mt-3 text-muted">
            Kein Scanner zur Hand? Gib dieses Geheimnis von Hand ein:
          </p>
          <code className="mt-1 block select-all rounded-md border border-line bg-subtle px-2.5 py-1.5 font-mono text-[13px] tracking-wide">
            {setup.grouped}
          </code>
          {/* Auf dem Telefon lässt sich der eigene Bildschirm nicht
              scannen — dieser Link öffnet die App direkt. */}
          <a
            href={setup.uri}
            className="mt-2 inline-block text-[12.5px] text-accent hover:underline"
          >
            Direkt in der Authenticator-App öffnen
          </a>
        </li>
        <li>
          <p className="font-medium">2. Code eintragen</p>
          <p className="mt-0.5 text-muted">
            Danach bekommst du Wiederherstellungscodes. Aktiv ist der
            zweite Faktor erst, wenn du einen davon bestätigt hast.
          </p>
        </li>
      </ol>

      <form action={action} className="space-y-3">
        <Field label="Sechsstelliger Code">
          <Input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            required
            className="font-mono tracking-[0.3em]"
          />
        </Field>
        <Status state={state} />
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Weiter"
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              // Das angefangene Geheimnis serverseitig wegräumen,
              // damit es in keiner App weiterlebt.
              void cancelTotpSetupAction();
              onCancel();
            }}
          >
            Abbrechen
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Abschalten und Codes erneuern — beides gegen das Passwort. */
function PasswordGate({
  label,
  hint,
  submitLabel,
  danger,
  action,
  onCodes,
  onDone,
}: {
  label: string;
  hint: string;
  submitLabel: string;
  danger?: boolean;
  action: (prev: TotpState, form: FormData) => Promise<TotpState>;
  onCodes?: (pending: PendingCodes) => void;
  onDone?: (message: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  const [state, formAction, pending] = useActionState<TotpState, FormData>(
    async (prev, form) => {
      const next = await action(prev, form);
      if (next?.recoveryCodes) {
        onCodes?.({
          codes: next.recoveryCodes,
          minutes: next.confirmMinutes ?? FALLBACK_MINUTES,
        });
        // Weiter geht es in der Bestätigung oben; das Passwortfeld hat
        // seinen Dienst getan.
        setArmed(false);
      }
      // Die Meldung wandert nach oben: nach dem Abschalten verschwindet
      // dieses Formular mitsamt seinem Zustand.
      if (next?.success) onDone?.(next.success);
      return next;
    },
    undefined,
  );

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors ${
          danger
            ? "border-danger/40 text-danger hover:bg-danger/10"
            : "border-line-strong text-muted hover:bg-subtle hover:text-ink"
        }`}
      >
        {danger ? (
          <ShieldOff className="h-3.5 w-3.5" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        {label}
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <p className="text-[12.5px] text-muted">{hint}</p>
      <Field label="Passwort zur Bestätigung">
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Status state={state} />
      <div className="flex gap-2">
        <Button
          type="submit"
          variant={danger ? "secondary" : "primary"}
          disabled={pending}
          className={danger ? "border-danger/40 text-danger" : undefined}
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            submitLabel
          )}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setArmed(false)}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}

export function TwoFactorForm({
  enabled,
  enabledAt,
  unusedCodes,
}: {
  enabled: boolean;
  enabledAt: string | null;
  unusedCodes: number;
}) {
  // Der Einrichtungsschritt liegt im lokalen Zustand und nicht im
  // Rückgabewert der Aktion: nur so lässt er sich beim Abbrechen wieder
  // schliessen.
  const [setup, setSetup] = useState<Setup | null>(null);
  const [start, startAction, starting] = useActionState<TotpState, FormData>(
    async (prev, form) => {
      const next = await startTotpSetupAction(prev, form);
      if (next?.setup) setSetup(next.setup);
      return next;
    },
    undefined,
  );
  // Ausgegebene, noch nicht bestätigte Codes. Sie liegen hier oben,
  // weil der Schritt, der sie geholt hat (Einrichtung oder Passwortfeld),
  // an ihrer Stelle verschwindet — ein zweites Mal gibt es den Klartext
  // nie.
  const [pending, setPending] = useState<PendingCodes | null>(null);
  // Dasselbe für die Erfolgsmeldung: sie überlebt den Zweigwechsel nur
  // hier oben.
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div
      id="zwei-faktor"
      className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-soft"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Zwei-Faktor-Anmeldung</h2>
          <p className="mt-1 text-[13px] text-muted">
            Zusätzlich zum Passwort ein Einmalcode aus deiner
            Authenticator-App. Ein gestohlenes Passwort allein genügt
            dann nicht mehr.
          </p>
        </div>
        {enabled && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[12px] font-medium text-emerald-600">
            <ShieldCheck className="h-3.5 w-3.5" />
            Aktiv
          </span>
        )}
      </div>

      {notice && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-600">
          {notice}
        </p>
      )}

      {enabled ? (
        <div className="space-y-4">
          {pending && (
            <ConfirmCodes
              pending={pending}
              renewing
              onConfirmed={(message) => {
                setPending(null);
                setNotice(message);
              }}
              onCancel={() => {
                // Serverseitig verwerfen: sonst bliebe der Satz bis zum
                // Ende der Frist bestätigbar, obwohl ihn niemand mehr
                // vor sich hat.
                void discardRecoveryCodesAction();
                setPending(null);
              }}
            />
          )}
          {enabledAt && (
            <p className="text-[12.5px] text-faint">
              Aktiv seit {enabledAt} · {unusedCodes}{" "}
              {unusedCodes === 1
                ? "unbenutzter Wiederherstellungscode"
                : "unbenutzte Wiederherstellungscodes"}
            </p>
          )}
          {unusedCodes === 0 && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-700">
              Keine Wiederherstellungscodes mehr übrig. Ohne sie sperrt
              dich ein verlorenes Telefon aus.
            </p>
          )}
          {/* Während ein neuer Satz auf Bestätigung wartet, kein zweiter
              Knopf dafür: ein weiterer Satz ersetzte den angezeigten. */}
          {!pending && (
            <PasswordGate
              label="Neue Wiederherstellungscodes"
              hint="Die bisherigen Codes gelten weiter, bis du einen der neuen bestätigst."
              submitLabel="Codes erneuern"
              action={regenerateRecoveryCodesAction}
              onCodes={(next) => {
                setNotice(null);
                setPending(next);
              }}
              onDone={setNotice}
            />
          )}
          <PasswordGate
            label="Zwei-Faktor abschalten"
            hint="Danach genügt wieder das Passwort allein."
            submitLabel="Abschalten"
            danger
            action={disableTotpAction}
            onDone={(message) => {
              // Ohne zweiten Faktor sind auch die Codes hinfällig — und
              // das abgeschlossene Einrichtungsgeheimnis erst recht,
              // sonst stünde es nach dem Abschalten wieder da.
              setPending(null);
              setSetup(null);
              setNotice(message);
            }}
          />
        </div>
      ) : pending ? (
        <ConfirmCodes
          pending={pending}
          renewing={false}
          onConfirmed={(message) => {
            setPending(null);
            setSetup(null);
            setNotice(message);
          }}
          onCancel={() => {
            // Geheimnis und ausgegebene Codes serverseitig wegräumen; der
            // Faktor war nie scharf, das Konto bleibt beim Passwort.
            void cancelTotpSetupAction();
            setPending(null);
            setSetup(null);
          }}
        />
      ) : setup ? (
        <SetupSteps
          setup={setup}
          onCodes={setPending}
          onCancel={() => setSetup(null)}
        />
      ) : (
        <form action={startAction} className="space-y-3">
          <Status state={start} />
          <Button type="submit" disabled={starting}>
            {starting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" />
                Einrichten
              </>
            )}
          </Button>
        </form>
      )}
    </div>
  );
}
