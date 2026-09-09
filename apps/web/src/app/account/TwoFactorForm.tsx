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
  confirmTotpAction,
  disableTotpAction,
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

type Setup = NonNullable<NonNullable<TotpState>["setup"]>;

/** Schritt 2 der Einrichtung: QR zeigen, Code prüfen. */
function SetupSteps({
  setup,
  onConfirmed,
  onCancel,
}: {
  setup: Setup;
  onConfirmed: (codes: string[], message: string) => void;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState<TotpState, FormData>(
    async (prev, form) => {
      const next = await confirmTotpAction(prev, form);
      // Nach dem Aktivieren rendert die Seite den anderen Zweig; Codes
      // und Meldung müssen deshalb oben liegen.
      if (next?.recoveryCodes) {
        onConfirmed(next.recoveryCodes, next.success ?? "Zwei-Faktor ist aktiv.");
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
              "Aktivieren"
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
  onCodes?: (codes: string[]) => void;
  onDone?: (message: string) => void;
}) {
  const [state, formAction, pending] = useActionState<TotpState, FormData>(
    async (prev, form) => {
      const next = await action(prev, form);
      if (next?.recoveryCodes) onCodes?.(next.recoveryCodes);
      // Die Meldung wandert nach oben: nach dem Abschalten verschwindet
      // dieses Formular mitsamt seinem Zustand.
      if (next?.success) onDone?.(next.success);
      return next;
    },
    undefined,
  );
  const [armed, setArmed] = useState(false);

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
  // Die Codes überleben das Neuladen der Seite nach dem Aktivieren
  // bewusst im Client-State: ein zweites Mal gibt es sie nie.
  const [codes, setCodes] = useState<string[] | null>(null);
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

      {codes && <RecoveryCodes codes={codes} />}

      {enabled ? (
        <div className="space-y-4">
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
          <PasswordGate
            label="Neue Wiederherstellungscodes"
            hint="Die bisherigen Codes verfallen dabei."
            submitLabel="Codes erneuern"
            action={regenerateRecoveryCodesAction}
            onCodes={setCodes}
            onDone={setNotice}
          />
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
              setCodes(null);
              setSetup(null);
              setNotice(message);
            }}
          />
        </div>
      ) : setup ? (
        <SetupSteps
          setup={setup}
          onConfirmed={(next, message) => {
            setCodes(next);
            setSetup(null);
            setNotice(message);
          }}
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
