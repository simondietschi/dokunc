import { NextResponse, type NextRequest } from "next/server";
import { NONCE_HEADER, contentSecurityPolicy, createNonce } from "@/lib/csp";

/**
 * Setzt die CSP der Dokumente pro Antwort, mit frischer Nonce.
 *
 * Warum ueberhaupt Middleware: eine Nonce muss sich je Antwort aendern,
 * und die Header aus next.config.ts sind statisch. Next liest die Nonce
 * aus der `Content-Security-Policy` der ANFRAGE und haengt sie an seine
 * eigenen Skript-Tags — deshalb steht der Wert hier zweimal, einmal auf
 * den weitergereichten Anfrage-Headern und einmal auf der Antwort.
 *
 * Nur in Produktion: in der Entwicklung laedt Next Ressourcen nach, die
 * 'self' nicht abdeckt, und der Collab-WS liegt auf einem eigenen Port.
 * Das war schon bisher die Bedingung fuer die CSP.
 */
const IS_PROD = process.env.NODE_ENV === "production";

export function middleware(request: NextRequest) {
  if (!IS_PROD) return NextResponse.next();

  const nonce = createNonce();
  const csp = contentSecurityPolicy(nonce);

  const headers = new Headers(request.headers);
  headers.set(NONCE_HEADER, nonce);
  headers.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Alles ausser: den ausgelieferten Dateien (_next/static, _next/image,
     * favicon) und /api. Die statischen Dateien brauchen keine
     * Skript-Richtlinie, und fuer /api setzt next.config.ts weiterhin die
     * Fassung ohne Nonce — dort entstehen keine Dokumente mit
     * Inline-Skripten.
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
