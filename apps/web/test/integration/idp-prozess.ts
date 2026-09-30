import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

/**
 * Startet den Test-IdP (e2e/test-idp/server.mts) als eigenen Prozess.
 *
 * Port 0: der IdP waehlt selbst einen freien Port und nennt den
 * Aussteller in seiner ersten Zeile auf stdout. Ein Port, den der Test
 * vorher probt, koennte bis zum Start schon belegt sein.
 */

const SERVER = fileURLToPath(
  new URL("../../../../e2e/test-idp/server.mts", import.meta.url),
);

export const IDP_CLIENT_ID = "dokunc-test";
export const IDP_CLIENT_SECRET = "test-idp-geheimnis-nur-fuer-tests";

export type TestIdp = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  stop(): Promise<void>;
};

export async function startIdp(o?: {
  redirectUris?: string[];
  port?: number;
}): Promise<TestIdp> {
  const kind = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      TEST_IDP_PORT: String(o?.port ?? 0),
      TEST_IDP_CLIENT_ID: IDP_CLIENT_ID,
      TEST_IDP_CLIENT_SECRET: IDP_CLIENT_SECRET,
      TEST_IDP_REDIRECT_URIS: (
        o?.redirectUris ?? ["http://localhost:3000/api/auth/oidc/callback"]
      ).join(","),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  kind.stderr.setEncoding("utf8");
  kind.stderr.on("data", (d: string) => {
    // Nur der Anfang: genug fuer eine Fehlermeldung beim Start.
    if (stderr.length < 8000) stderr += d;
  });

  const beendet = new Promise<void>((resolve) => kind.once("exit", () => resolve()));

  const issuer = await new Promise<string>((resolve, reject) => {
    const zeilen = createInterface({ input: kind.stdout });
    const frist = setTimeout(() => {
      kind.kill("SIGKILL");
      reject(new Error(`Test-IdP startet nicht binnen 15 s: ${stderr}`));
    }, 15_000);
    zeilen.on("line", (zeile) => {
      try {
        const wert = JSON.parse(zeile) as { issuer?: unknown };
        if (typeof wert.issuer === "string") {
          clearTimeout(frist);
          resolve(wert.issuer);
        }
      } catch {
        // Keine JSON-Zeile: nicht die Startmeldung.
      }
    });
    kind.once("exit", (code) => {
      clearTimeout(frist);
      reject(new Error(`Test-IdP beendet (Code ${code}): ${stderr}`));
    });
  });

  return {
    issuer,
    clientId: IDP_CLIENT_ID,
    clientSecret: IDP_CLIENT_SECRET,
    async stop() {
      if (kind.exitCode !== null || kind.signalCode !== null) return;
      kind.kill("SIGTERM");
      const hart = setTimeout(() => kind.kill("SIGKILL"), 5_000);
      await beendet;
      clearTimeout(hart);
    },
  };
}
