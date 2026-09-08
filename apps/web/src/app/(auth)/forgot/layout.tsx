import type { Metadata } from "next";

// forgot/page.tsx ist eine Client-Komponente und kann selbst keine
// Metadaten exportieren, deshalb dieses schlanke Layout.
export const metadata: Metadata = {
  title: "Passwort vergessen",
};

export default function ForgotLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
