import type { Metadata } from "next";
import { headers } from "next/headers";
import { AuthForm } from "../AuthForm";
import { LocalDataCleanup } from "@/components/auth/LocalDataCleanup";
import { getCurrentUser } from "@/lib/current-user";
import { hasSessionCookie } from "@/lib/session";
import { oidcConfig } from "@/lib/oidc";
import { setupStatus } from "@/lib/setup-token";
import { singleParam, type SearchParams } from "@/lib/search-params";

export const metadata: Metadata = {
  title: "Anmelden",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const query = await searchParams;
  const next = singleParam(query.next);
  const sso = singleParam(query.sso);
  const status = await setupStatus(await headers());
  // Ohne gueltige Sitzung keine lokalen Kopien: die Anmeldeseite raeumt
  // sie weg. Wer angemeldet ist und /login von Hand oeffnet, verliert
  // nichts. Ein Cookie ohne gueltige Sitzung heisst: die Sitzung endete,
  // und Clear-Site-Data kam nicht an (weiche Navigation, fremder Link).
  const angemeldet = (await getCurrentUser()) !== null;
  const sitzungsCookie = !angemeldet && (await hasSessionCookie());
  return (
    <>
      {!angemeldet && (
        <LocalDataCleanup sitzungsCookie={sitzungsCookie} next={next} sso={sso} />
      )}
      <AuthForm
        mode="login"
        next={next}
        sso={oidcConfig()?.label ?? null}
        ssoError={sso}
        ersteinrichtung={
          status.offen
            ? { tokenNoetig: status.tokenNoetig, tokenDatei: status.tokenDatei }
            : null
        }
      />
    </>
  );
}
