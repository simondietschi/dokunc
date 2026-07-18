import { describe, expect, it } from "vitest";
import {
  isAuthPath,
  likeEscape,
  matchesQuery,
  spaceSlugFromPath,
  splitHighlights,
} from "./palette";

describe("isAuthPath", () => {
  it("erkennt Auth-Seiten", () => {
    expect(isAuthPath("/login")).toBe(true);
    expect(isAuthPath("/register")).toBe(true);
    expect(isAuthPath("/forgot")).toBe(true);
    expect(isAuthPath("/reset/abc")).toBe(true);
    expect(isAuthPath("/invite/xyz")).toBe(true);
  });

  it("lässt App-Seiten durch", () => {
    expect(isAuthPath("/spaces")).toBe(false);
    expect(isAuthPath("/s/engineering")).toBe(false);
    expect(isAuthPath("/loginfoo")).toBe(false);
  });
});

describe("spaceSlugFromPath", () => {
  it("extrahiert den Slug aus Space-Pfaden", () => {
    expect(spaceSlugFromPath("/s/engineering")).toBe("engineering");
    expect(spaceSlugFromPath("/s/engineering/p/abc123")).toBe("engineering");
    expect(spaceSlugFromPath("/s/team-handbuch/search?q=x")).toBe(
      "team-handbuch",
    );
  });

  it("dekodiert URL-encodete Slugs", () => {
    expect(spaceSlugFromPath("/s/caf%C3%A9")).toBe("café");
  });

  it("liefert null außerhalb von Spaces", () => {
    expect(spaceSlugFromPath("/spaces")).toBeNull();
    expect(spaceSlugFromPath("/ask")).toBeNull();
    expect(spaceSlugFromPath("/")).toBeNull();
    expect(spaceSlugFromPath("/settings/s/x")).toBeNull();
  });
});

describe("matchesQuery", () => {
  it("matcht case-insensitiv als Substring", () => {
    expect(matchesQuery("Theme umschalten", "theme")).toBe(true);
    expect(matchesQuery("Theme umschalten", "UMSCH")).toBe(true);
    expect(matchesQuery("Frag dein Wiki", "wiki frag")).toBe(true);
  });

  it("verlangt alle Tokens", () => {
    expect(matchesQuery("Frag dein Wiki", "wiki admin")).toBe(false);
  });

  it("leere Eingabe matcht alles", () => {
    expect(matchesQuery("Konto", "")).toBe(true);
    expect(matchesQuery("Konto", "   ")).toBe(true);
  });
});

describe("likeEscape", () => {
  it("escaped LIKE-Metazeichen", () => {
    expect(likeEscape("100%_\\x")).toBe("100\\%\\_\\\\x");
    expect(likeEscape("normal")).toBe("normal");
  });
});

describe("splitHighlights", () => {
  it("zerlegt Treffer-Marker in Segmente", () => {
    expect(splitHighlights("ein ⟦Wort⟧ mehr")).toEqual([
      { text: "ein ", hit: false },
      { text: "Wort", hit: true },
      { text: " mehr", hit: false },
    ]);
  });

  it("behandelt mehrere Treffer", () => {
    expect(splitHighlights("⟦a⟧ und ⟦b⟧")).toEqual([
      { text: "a", hit: true },
      { text: " und ", hit: false },
      { text: "b", hit: true },
    ]);
  });

  it("HTML im Text bleibt Text (kein Parsen)", () => {
    expect(splitHighlights("<img src=x> ⟦böse⟧")).toEqual([
      { text: "<img src=x> ", hit: false },
      { text: "böse", hit: true },
    ]);
  });

  it("unvollständige Marker brechen nicht", () => {
    expect(splitHighlights("kaputt ⟦offen")).toEqual([
      { text: "kaputt ", hit: false },
      { text: "offen", hit: false },
    ]);
    expect(splitHighlights("")).toEqual([]);
  });
});
