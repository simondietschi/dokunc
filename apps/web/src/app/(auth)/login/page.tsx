import type { Metadata } from "next";
import { AuthForm } from "../AuthForm";
import { oidcConfig } from "@/lib/oidc";

export const metadata: Metadata = {
  title: "Anmelden",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; sso?: string }>;
}) {
  const { next, sso } = await searchParams;
  return (
    <AuthForm
      mode="login"
      next={next}
      sso={oidcConfig()?.label ?? null}
      ssoError={sso}
    />
  );
}
