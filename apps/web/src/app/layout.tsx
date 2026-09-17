import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { CommandPalette } from "@/components/CommandPalette";
import { ToastProvider } from "@/components/ui/Toast";
import { headers } from "next/headers";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { NONCE_HEADER } from "@/lib/csp";
import "./globals.css";

export const metadata: Metadata = {
  // %s wird pro Route gesetzt; ohne Titel greift der Default.
  title: {
    default: "dokunc — kollaboratives Team-Wiki",
    template: "%s · dokunc",
  },
  description:
    "Schreibt gemeinsam in Echtzeit. Ein schnelles, schönes Wiki für euer Team.",
  applicationName: "dokunc",
  // Internes Wiki hinter Login: nicht indexieren.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfd" },
    { media: "(prefers-color-scheme: dark)", color: "#08090a" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Die Nonce dieser Antwort, gesetzt von src/middleware.ts. In der
  // Entwicklung gibt es keine — dort laeuft auch keine CSP.
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  return (
    <html
      lang="de"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Setzt das Theme vor dem ersten Paint (kein Flackern). Bleibt
            inline; Schluessel und Klassenname kommen aus lib/theme, damit
            Skript und Umschalter dieselben verwenden. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body className="font-sans">
        <a href="#main" className="skip-link">
          Zum Inhalt springen
        </a>
        <ToastProvider>
          <div id="main" tabIndex={-1} className="outline-none">
            {children}
          </div>
          <CommandPalette />
        </ToastProvider>
      </body>
    </html>
  );
}
