import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { CommandPalette } from "@/components/CommandPalette";
import { ToastProvider } from "@/components/ui/Toast";
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

// Setzt das Theme vor dem ersten Paint (kein Flackern).
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="de"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
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
