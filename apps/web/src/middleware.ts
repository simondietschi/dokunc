import { NextResponse, type NextRequest } from "next/server";
import {
  NONCE_HEADER,
  contentSecurityPolicy,
  createNonce,
  cspMode,
} from "@/lib/csp";

/**
 * Setzt die CSP der Dokumente pro Antwort, mit frischer Nonce.
 *
 * Warum ueberhaupt Middleware: eine Nonce muss sich je Antwort aendern,
 * und die Header aus next.config.ts sind statisch. Next liest die Nonce
 * aus der `Content-Security-Policy` der ANFRAGE und haengt sie an seine
 * eigenen Skript-Tags — deshalb steht der Wert hier zweimal, einmal auf
 * den weitergereichten Anfrage-Headern und einmal auf der Antwort.
 *
 * In jedem Modus, auch in der Entwicklung: dort nur in der gelockerten
 * Fassung (siehe lib/csp.ts), die Fast Refresh und HMR zulaesst. Bisher
 * lief die Entwicklung ganz ohne CSP, und ein Verstoss — etwa ein neues
 * Inline-Skript ohne Nonce — fiel erst im Build auf.
 */
export function middleware(request: NextRequest) {
  // Zur Anfragezeit statt beim Laden des Moduls: Next setzt NODE_ENV im
  // Bundle ohnehin fest ein, aber so lassen sich beide Fassungen im
  // Unit-Test pruefen, ohne das Modul neu zu laden.
  const mode = cspMode();
  const nonce = createNonce();
  const csp = contentSecurityPolicy(nonce, {
    mode,
    devServer: request.nextUrl.origin,
  });

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
     * Skript-Richtlinie, und fuer /api setzt next.config.ts die strenge
     * Fassung ohne Nonce, auch unter next dev — dort entstehen keine
     * Dokumente mit Inline-Skripten, und Fast Refresh laeuft dort nicht.
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
