import type { Metadata } from "next";
import { singleParam, type SearchParams } from "@/lib/search-params";
import { ResetForm } from "./ResetForm";

export const metadata: Metadata = {
  title: "Neues Passwort",
};

export default async function ResetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  // Mehrfach angegeben zaehlt als fehlend; das Formular meldet beim
  // Absenden "Link ungueltig" wie bei jedem anderen falschen Token.
  const token = singleParam((await searchParams).token) ?? "";
  return <ResetForm id={id} token={token} />;
}
