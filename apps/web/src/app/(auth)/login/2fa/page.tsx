import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readPending2fa } from "@/lib/pending-2fa";
import { TotpForm } from "./TotpForm";

export const metadata: Metadata = {
  title: "Bestätigung",
  description: "Zweiter Faktor der Anmeldung.",
};

export default async function TwoFactorPage() {
  // Ohne den Zwischenschritt aus dem Passwort-Formular gibt es hier
  // nichts zu bestätigen.
  if (!(await readPending2fa())) redirect("/login");
  return <TotpForm />;
}
