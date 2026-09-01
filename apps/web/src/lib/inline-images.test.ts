import { describe, expect, it, vi } from "vitest";
import { inlineUploadImages } from "./inline-images";

const png = (name: string) => ({
  base64: "AAAA",
  contentType: name.endsWith(".png") ? "image/png" : "image/jpeg",
});

describe("inlineUploadImages", () => {
  it("ersetzt Upload-Verweise durch data:-URIs", async () => {
    const html = '<img src="/api/files/abc.png" alt="x">';
    const out = await inlineUploadImages(html, async (n) => png(n));
    expect(out).toBe('<img src="data:image/png;base64,AAAA" alt="x">');
  });

  it("lädt jede Datei nur einmal, auch bei mehrfacher Verwendung", async () => {
    const load = vi.fn(async (n: string) => png(n));
    const html =
      '<img src="/api/files/a.png"><img src="/api/files/a.png">';
    const out = await inlineUploadImages(html, load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(out.match(/data:image\/png/g)).toHaveLength(2);
  });

  it("lässt fremde und externe Quellen unangetastet", async () => {
    const html =
      '<img src="https://example.com/x.png"><img src="data:image/png;base64,Zm9v">';
    expect(await inlineUploadImages(html, async () => png("x.png"))).toBe(html);
  });

  it("behält den Verweis, wenn die Datei fehlt", async () => {
    const html = '<img src="/api/files/weg.png">';
    expect(await inlineUploadImages(html, async () => null)).toBe(html);
  });

  it("überspringt Dateien jenseits des Budgets", async () => {
    const html = '<img src="/api/files/gross.png">';
    const out = await inlineUploadImages(
      html,
      async () => ({ base64: "x".repeat(100), contentType: "image/png" }),
      50,
    );
    expect(out).toBe(html);
  });

  it("ignoriert unsichere Dateinamen (kein Path-Traversal)", async () => {
    const load = vi.fn(async () => png("x.png"));
    const html = '<img src="/api/files/..%2Fsecret">';
    await inlineUploadImages(html, load);
    expect(load).not.toHaveBeenCalled();
  });
});
