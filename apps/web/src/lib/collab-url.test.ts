import { describe, expect, it } from "vitest";
import { resolveCollabUrl } from "./collab-url";

describe("resolveCollabUrl", () => {
  it("nimmt die konfigurierte Adresse, wenn gesetzt", () => {
    expect(
      resolveCollabUrl({
        configured: "wss://collab.example.com",
        host: "wiki.example.com",
        proto: "https",
      }),
    ).toBe("wss://collab.example.com");
  });

  it("leitet hinter TLS wss://<host>/collab ab", () => {
    expect(
      resolveCollabUrl({ host: "wiki.example.com", proto: "https" }),
    ).toBe("wss://wiki.example.com/collab");
  });

  it("bleibt ohne TLS bei ws://", () => {
    expect(resolveCollabUrl({ host: "localhost:3000", proto: "http" })).toBe(
      "ws://localhost:3000/collab",
    );
  });

  it("liest bei mehreren Proxys das linke Schema", () => {
    expect(
      resolveCollabUrl({ host: "wiki.example.com", proto: "https,http" }),
    ).toBe("wss://wiki.example.com/collab");
  });

  it("behandelt eine leere Konfiguration wie keine", () => {
    expect(
      resolveCollabUrl({ configured: "  ", host: "x.test", proto: "https" }),
    ).toBe("wss://x.test/collab");
  });

  it("fällt ohne Host auf die lokale Entwicklungsadresse zurück", () => {
    expect(resolveCollabUrl({})).toBe("ws://localhost:3001");
  });
});
