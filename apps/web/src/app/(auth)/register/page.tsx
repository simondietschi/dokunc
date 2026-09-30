import type { Metadata } from "next";
import { headers } from "next/headers";
import { singleParam, type SearchParams } from "@/lib/search-params";
import { setupStatus } from "@/lib/setup-token";
import { AuthForm } from "../AuthForm";

export const metadata: Metadata = {
  title: "Registrieren",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const next = singleParam((await searchParams).next);
  const status = await setupStatus((await headers()).get("host"));
  return (
    <AuthForm
      mode="register"
      next={next}
      ersteinrichtung={
        status.offen
          ? { tokenNoetig: status.tokenNoetig, tokenDatei: status.tokenDatei }
          : null
      }
    />
  );
}
