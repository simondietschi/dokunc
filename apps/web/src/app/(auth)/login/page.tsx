import type { Metadata } from "next";
import { headers } from "next/headers";
import { AuthForm } from "../AuthForm";
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
  return (
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
  );
}
