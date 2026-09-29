import type { Metadata } from "next";
import { AuthForm } from "../AuthForm";
import { oidcConfig } from "@/lib/oidc";
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
  return (
    <AuthForm
      mode="login"
      next={next}
      sso={oidcConfig()?.label ?? null}
      ssoError={sso}
    />
  );
}
