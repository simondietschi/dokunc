import type { Metadata } from "next";
import { singleParam, type SearchParams } from "@/lib/search-params";
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
  return <AuthForm mode="register" next={next} />;
}
