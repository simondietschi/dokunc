import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocResetMessage } from "@dokunc/editor";
import {
  createDocResetHandler,
  type DocResetDeps,
  type DocResetOptions,
  type ResetContent,
} from "./doc-reset";

const MESSAGE: DocResetMessage = { pageId: "p1", nonce: "n1", versionId: "v1" };
const VERSION_CONTENT = { type: "doc", content: [] };

const OPTIONS: DocResetOptions = {
  nonHolderDelayMs: 250,
  retryDelaysMs: [200, 500],
  budgetMs: 3_500,
  storeDeadlineMs: 4_500,
  claimRetryDelayMs: 100,
};

/**
 * Abhaengigkeiten als Attrappen. Die Uhr laeuft nur, wenn geschlafen
 * wird, damit die Zeitgrenze sich genau pruefen laesst.
 */
function setup(over: Partial<DocResetDeps> = {}) {
  let clock = 0;
  const sleeps: number[] = [];
  const deps = {
    claim: vi.fn(async () => true),
    isLoadedHere: vi.fn(() => true),
    isLoadedElsewhere: vi.fn(async () => true),
    loadContent: vi.fn(
      async (): Promise<ResetContent> => ({
        kind: "inhalt",
        content: VERSION_CONTENT,
      }),
    ),
    applyContent: vi.fn(async () => undefined),
    acknowledge: vi.fn(async () => undefined),
    sleep: vi.fn(async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    }),
    now: () => clock,
    log: { info: vi.fn(), warn: vi.fn() },
    ...over,
  } satisfies DocResetDeps;
  const advance = (ms: number) => {
    clock += ms;
  };
  return { deps, sleeps, advance, handle: createDocResetHandler(deps, OPTIONS) };
}

afterEach(() => {
  vi.useRealTimers();
});

/** Wie setup(), fuer eine Instanz ohne Dokument und mit eigenem Budget. */
function createDocResetHandlerWithBudget(budgetMs: number) {
  const { deps } = setup({
    isLoadedHere: vi.fn(() => false),
    isLoadedElsewhere: vi.fn(async () => true),
  });
  return { deps, handle: createDocResetHandler(deps, { ...OPTIONS, budgetMs }) };
}

describe("Doc-Reset auf der Collab-Seite", () => {
  it("tauscht auf der Instanz mit dem Dokument aus und quittiert positiv", async () => {
    const { deps, sleeps, handle } = setup();
    await handle(MESSAGE);
    expect(sleeps).toEqual([]);
    expect(deps.claim).toHaveBeenCalledWith("n1");
    expect(deps.loadContent).toHaveBeenCalledWith(MESSAGE);
    // Die ganze Nachricht geht mit (Seite, Person), dazu die Frist als
    // Zeitpunkt: Eingang (0) plus 4500 ms.
    expect(deps.applyContent).toHaveBeenCalledWith(
      MESSAGE,
      VERSION_CONTENT,
      4_500,
    );
    expect(deps.acknowledge).toHaveBeenCalledWith("n1", {
      ok: true,
      outcome: "zurueckgesetzt",
    });
  });

  // Die Frist zaehlt ab Eingang der Nachricht und ist ein Zeitpunkt:
  // ein Versuch, der spaet beginnt, bekommt dieselbe und hat damit
  // entsprechend weniger Zeit.
  it("gibt jedem Versuch dieselbe feste Frist ab Eingang", async () => {
    const applyContent = vi
      .fn()
      .mockRejectedValueOnce(new Error("Datenbank weg"))
      .mockResolvedValueOnce(undefined);
    const { handle } = setup({ applyContent });
    await handle(MESSAGE);
    expect(applyContent.mock.calls.map((c) => c[2])).toEqual([4_500, 4_500]);
  });

  // Die Quittung muss vor dem Zeitlimit der Web-App liegen, auch wenn
  // schon das Laden des Dokuments fuer den Austausch lange dauert. Hier:
  // der erste Versuch scheitert nach 3000 ms, der zweite beginnt bei
  // 3200 ms, laedt 600 ms und wartet dann auf einen Speicherlauf, der nie
  // kommt. Als Dauer ab Versuchsbeginn gerechnet (1300 ms nach dem Laden)
  // kaeme die Quittung erst bei 5100 ms, nach dem Zeitlimit der Web-App.
  it("haelt die Frist auch, wenn das Laden des Dokuments dauert", async () => {
    vi.useFakeTimers({ now: 0 });
    const warte = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));
    let quittiertUm: number | null = null;
    const applyContent = vi
      .fn()
      .mockImplementationOnce(async () => {
        await warte(3_000);
        throw new Error("Datenbank weg");
      })
      .mockImplementationOnce(async () => {
        await warte(600); // Laden
        await new Promise<never>(() => {}); // Speicherlauf kommt nie
      });
    const { deps, handle } = setup({
      applyContent,
      now: () => Date.now(),
      sleep: vi.fn(warte),
      acknowledge: vi.fn(async () => {
        quittiertUm = Date.now();
      }),
    });

    const fertig = handle(MESSAGE);
    await vi.advanceTimersByTimeAsync(4_499);
    expect(applyContent).toHaveBeenCalledTimes(2);
    expect(quittiertUm).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(quittiertUm).toBe(4_500);
    expect(deps.acknowledge).toHaveBeenCalledWith("n1", {
      ok: false,
      outcome: "fehlgeschlagen",
    });
    await fertig;
  });

  // Die Frist gilt auch fuer das Lesen des Inhalts, nicht nur fuer
  // applyContent. Der erste Versuch scheitert nach 3000 ms beim Lesen,
  // der zweite beginnt bei 3200 ms und liest 2000 ms lang: ohne Frist
  // dort begaenne der Austausch erst bei 5200 ms, und die Quittung kaeme
  // nach dem Zeitlimit der Web-App.
  it("haelt die Frist auch, wenn schon das Lesen des Inhalts dauert", async () => {
    vi.useFakeTimers({ now: 0 });
    const warte = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));
    let quittiertUm: number | null = null;
    const loadContent = vi
      .fn()
      .mockImplementationOnce(async () => {
        await warte(3_000);
        throw new Error("Datenbank weg");
      })
      .mockImplementationOnce(async (): Promise<ResetContent> => {
        await warte(2_000);
        return { kind: "inhalt", content: VERSION_CONTENT };
      });
    const { deps, handle } = setup({
      loadContent,
      now: () => Date.now(),
      sleep: vi.fn(warte),
      acknowledge: vi.fn(async () => {
        quittiertUm = Date.now();
      }),
    });

    const fertig = handle(MESSAGE);
    await vi.advanceTimersByTimeAsync(4_500);
    expect(quittiertUm).toBe(4_500);
    expect(deps.acknowledge).toHaveBeenCalledWith("n1", {
      ok: false,
      outcome: "fehlgeschlagen",
    });
    // Auch spaeter nicht: der Inhalt kommt bei 5200 ms, ausgetauscht
    // wird nach der Frist nicht mehr.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(deps.applyContent).not.toHaveBeenCalled();
    await fertig;
  });

  // Ist die Frist schon um, wenn der Inhalt da ist, wird nicht mehr
  // ausgetauscht: noch ist kein Dokument geladen, und ohne Austausch
  // bleibt alles, wie es war.
  it("tauscht nicht mehr aus, wenn die Frist beim Lesen abgelaufen ist", async () => {
    const box = { advance: (_ms: number) => {} };
    const loadContent = vi.fn(async (): Promise<ResetContent> => {
      box.advance(4_600);
      return { kind: "inhalt", content: VERSION_CONTENT };
    });
    const { deps, handle, advance } = setup({ loadContent });
    box.advance = advance;
    await handle(MESSAGE);
    expect(deps.applyContent).not.toHaveBeenCalled();
    expect(deps.acknowledge).toHaveBeenCalledWith("n1", {
      ok: false,
      outcome: "fehlgeschlagen",
    });
  });

  // Wer das Dokument nicht hat, laesst der haltenden Instanz den
  // Vortritt: sie tauscht ohne Neuladen aus.
  it("bewirbt sich ohne geladenes Dokument erst nach dem Vorsprung", async () => {
    const order: string[] = [];
    const { handle } = setup({
      isLoadedHere: () => false,
      sleep: async (ms) => {
        order.push(`sleep ${ms}`);
      },
      claim: async () => {
        order.push("claim");
        return false;
      },
    });
    await handle(MESSAGE);
    expect(order).toEqual(["sleep 250", "claim"]);
  });

  it("tut nichts und quittiert nicht, wenn eine andere Instanz die Nonce hat", async () => {
    const { deps, handle } = setup({ claim: vi.fn(async () => false) });
    await handle(MESSAGE);
    expect(deps.loadContent).not.toHaveBeenCalled();
    expect(deps.applyContent).not.toHaveBeenCalled();
    expect(deps.acknowledge).not.toHaveBeenCalled();
  });

  // Haelt keine Instanz das Dokument, tauscht die Gewinnerin trotzdem aus
  // (applyContent laedt es dafuer aus CollabDocument). Nur so bekommen
  // Kopien im Browser, die spaeter verbinden, die Loeschungen mit; ein
  // "nichts zu tun" liesse den naechsten Start aus Page.content eine neue
  // Linie bauen, und der alte Inhalt kaeme aus der Kopie zurueck.
  it("tauscht auch aus, wenn keine Instanz das Dokument haelt", async () => {
    const { deps, handle } = setup({
      isLoadedHere: vi.fn(() => false),
      isLoadedElsewhere: vi.fn(async () => false),
    });
    await handle(MESSAGE);
    expect(deps.loadContent).toHaveBeenCalledWith(MESSAGE);
    // Der Vorsprung (250 ms) verschiebt die Frist nicht.
    expect(deps.applyContent).toHaveBeenCalledWith(
      MESSAGE,
      VERSION_CONTENT,
      4_500,
    );
    expect(deps.acknowledge).toHaveBeenCalledWith("n1", {
      ok: true,
      outcome: "zurueckgesetzt",
    });
  });

  // Die Pruefung fuer aeltere Web-Apps ohne versionId sieht nach, ob
  // wieder ein CollabDocument da ist; das Laden fuer den Austausch legt
  // eines an. Also erst lesen, dann laden.
  it("liest den Inhalt, bevor es das Dokument fuer den Austausch laedt", async () => {
    const order: string[] = [];
    const { handle } = setup({
      isLoadedHere: vi.fn(() => false),
      isLoadedElsewhere: vi.fn(async () => false),
      loadContent: vi.fn(async (): Promise<ResetContent> => {
        order.push("loadContent");
        return { kind: "inhalt", content: VERSION_CONTENT };
      }),
      applyContent: vi.fn(async () => {
        order.push("applyContent");
      }),
    });
    await handle(MESSAGE);
    expect(order).toEqual(["loadContent", "applyContent"]);
  });

  // Der Kern des Mehr-Instanzen-Falls: gewinnt eine Instanz ohne das
  // Dokument die Nonce, waehrend eine andere den alten Stand haelt, darf
  // sie weder "nichts zu tun" melden noch das Dokument fuer den Austausch
  // selbst laden (kaeme der Stand der anderen zu spaet, stuende alter
  // und neuer Inhalt nebeneinander — quittiert als Erfolg).
  it("quittiert negativ, wenn sie ohne Dokument gewinnt und eine andere Instanz es haelt", async () => {
    const { deps, sleeps, handle } = setup({
      isLoadedHere: vi.fn(() => false),
      isLoadedElsewhere: vi.fn(async () => true),
    });
    await handle(MESSAGE);
    expect(deps.loadContent).not.toHaveBeenCalled();
    expect(deps.applyContent).not.toHaveBeenCalled();
    // Vorsprung, dann zwei Wiederholungen der Frage.
    expect(sleeps).toEqual([250, 200, 500]);
    expect(deps.isLoadedElsewhere).toHaveBeenCalledTimes(3);
    expect(deps.acknowledge).toHaveBeenCalledWith("n1", {
      ok: false,
      outcome: "andere-instanz",
    });
  });

  it("tauscht selbst aus, wenn die andere Instanz das Dokument inzwischen entladen hat", async () => {
    const { deps, handle } = setup({
      isLoadedHere: vi.fn(() => false),
      isLoadedElsewhere: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    });
    await handle(MESSAGE);
    expect(deps.applyContent).toHaveBeenCalledTimes(1);
    expect(deps.acknowledge).toHaveBeenCalledWith("n1", {
      ok: true,
      outcome: "zurueckgesetzt",
    });
  });

  it("fragt nicht nach anderen Instanzen, wenn sie das Dokument selbst haelt", async () => {
    const { deps, handle } = setup();
    await handle(MESSAGE);
    expect(deps.isLoadedElsewhere).not.toHaveBeenCalled();
  });

  it("versucht einen gescheiterten Austausch begrenzt erneut", async () => {
    const applyContent = vi
      .fn()
      .mockRejectedValueOnce(new Error("Datenbank weg"))
      .mockRejectedValueOnce(new Error("Datenbank weg"))
      .mockResolvedValueOnce(undefined);
    const { deps, sleeps, handle } = setup({ applyContent });
    await handle(MESSAGE);
    expect(applyContent).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([200, 500]);
    expect(deps.acknowledge).toHaveBeenCalledWith("n1", {
      ok: true,
      outcome: "zurueckgesetzt",
    });
  });

  it("quittiert negativ, wenn auch die Wiederholungen scheitern", async () => {
    const fehler = new Error("Datenbank weg");
    const applyContent = vi.fn().mockRejectedValue(fehler);
    const { deps, handle } = setup({ applyContent });
    await handle(MESSAGE);
    expect(applyContent).toHaveBeenCalledTimes(3);
    expect(deps.acknowledge).toHaveBeenCalledWith("n1", {
      ok: false,
      outcome: "fehlgeschlagen",
    });
    // Der Fehler selbst geht ins Log, nicht nur "fehlgeschlagen".
    expect(deps.log.warn).toHaveBeenCalledWith(
      { err: fehler, pageId: "p1", versuche: 3, outcome: "fehlgeschlagen" },
      "Dokument nicht zurueckgesetzt",
    );
  });

  it("wiederholt auch, wenn schon die Frage nach anderen Instanzen scheitert", async () => {
    const isLoadedElsewhere = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection is closed."))
      .mockResolvedValueOnce(false);
    const { deps, handle } = setup({
      isLoadedHere: vi.fn(() => false),
      isLoadedElsewhere,
    });
    await handle(MESSAGE);
    expect(deps.applyContent).toHaveBeenCalledTimes(1);
    expect(deps.acknowledge).toHaveBeenCalledWith("n1", {
      ok: true,
      outcome: "zurueckgesetzt",
    });
  });

  // Zwischen zwei Versuchen kann das Dokument auf eine andere Instanz
  // gewandert sein (hier entladen, dort geladen). Dann nicht selbst neu
  // laden und austauschen, sondern wie bei jeder fremden Instanz warten.
  it("prueft vor jedem Versuch neu, wer das Dokument haelt", async () => {
    const isLoadedHere = vi
      .fn()
      .mockReturnValueOnce(true) // Vorsprung
      .mockReturnValueOnce(true) // erster Versuch
      .mockReturnValue(false);
    const { deps, handle } = setup({
      isLoadedHere,
      isLoadedElsewhere: vi.fn(async () => true),
      applyContent: vi.fn().mockRejectedValueOnce(new Error("weg")),
    });
    await handle(MESSAGE);
    expect(deps.applyContent).toHaveBeenCalledTimes(1);
    expect(deps.acknowledge).toHaveBeenCalledWith("n1", {
      ok: false,
      outcome: "andere-instanz",
    });
  });

  // Scheitert schon das Speichern des ausgetauschten Stands, gilt der
  // Versuch als gescheitert: ohne gespeicherten Stand baute der naechste
  // Start das Dokument aus dem alten auf.
  it("quittiert negativ, wenn der ausgetauschte Stand nicht gespeichert wird", async () => {
    const { deps, handle } = setup({
      applyContent: vi
        .fn()
        .mockRejectedValue(new Error("Stand nicht innerhalb von 4500 ms gespeichert")),
    });
    await handle(MESSAGE);
    expect(deps.acknowledge).toHaveBeenCalledWith("n1", {
      ok: false,
      outcome: "fehlgeschlagen",
    });
  });

  it.each(["version-fehlt", "seite-fehlt", "ueberschrieben"] as const)(
    "quittiert %s sofort negativ, ohne Wiederholung",
    async (outcome) => {
      const { deps, sleeps, handle } = setup({
        loadContent: vi.fn(async (): Promise<ResetContent> => ({
          kind: "abbruch",
          outcome,
        })),
      });
      await handle(MESSAGE);
      expect(deps.loadContent).toHaveBeenCalledTimes(1);
      expect(deps.applyContent).not.toHaveBeenCalled();
      expect(sleeps).toEqual([]);
      expect(deps.acknowledge).toHaveBeenCalledWith("n1", { ok: false, outcome });
    },
  );

  // Eine Quittung nach dem Zeitlimit der Web-App liest niemand mehr.
  it("beginnt keinen Versuch mehr, der das Zeitbudget sprengen wuerde", async () => {
    const box = { advance: (_ms: number) => {} };
    // Ein langsamer Versuch: 3400 ms plus die erste Pause von 200 ms
    // laegen ueber dem Budget von 3500 ms.
    const applyContent = vi.fn(async () => {
      box.advance(3_400);
      throw new Error("haengt");
    });
    const { deps, sleeps, advance, handle } = setup({ applyContent });
    box.advance = advance;
    await handle(MESSAGE);
    expect(applyContent).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
    expect(deps.acknowledge).toHaveBeenCalledWith("n1", {
      ok: false,
      outcome: "fehlgeschlagen",
    });
  });

  it("zaehlt den Vorsprung zum Zeitbudget", async () => {
    const { deps, handle } = createDocResetHandlerWithBudget(900);
    // 250 Vorsprung + 200 Pause liegen im Budget von 900, weitere 500
    // nicht mehr: zwei Versuche statt drei.
    await handle(MESSAGE);
    expect(deps.isLoadedElsewhere).toHaveBeenCalledTimes(2);
    expect(deps.acknowledge).toHaveBeenCalledWith("n1", {
      ok: false,
      outcome: "andere-instanz",
    });
  });

  // Ein Redis-Fehler beim Belegen der Nonce liess die Nachricht bisher
  // ohne Quittung liegen; die Web-App wartete ihr volles Zeitlimit.
  it("belegt die Nonce nach einem Redis-Fehler ein zweites Mal", async () => {
    const claim = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection is closed."))
      .mockResolvedValueOnce(true);
    const { deps, sleeps, handle } = setup({ claim });
    await handle(MESSAGE);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([100]);
    expect(deps.applyContent).toHaveBeenCalledTimes(1);
    expect(deps.acknowledge).toHaveBeenCalledWith("n1", {
      ok: true,
      outcome: "zurueckgesetzt",
    });
  });

  // Geht auch der zweite Versuch nicht, weiss diese Instanz nicht, ob
  // eine andere die Nonce hat und gerade austauscht. Eine negative
  // Quittung von hier koennte deren positive ueberholen.
  it("tauscht ohne belegte Nonce nicht aus und quittiert nicht", async () => {
    const fehler = new Error("Connection is closed.");
    const claim = vi.fn().mockRejectedValue(fehler);
    const { deps, handle } = setup({ claim });
    await expect(handle(MESSAGE)).resolves.toBeUndefined();
    expect(claim).toHaveBeenCalledTimes(2);
    expect(deps.applyContent).not.toHaveBeenCalled();
    expect(deps.acknowledge).not.toHaveBeenCalled();
    expect(deps.log.warn).toHaveBeenCalledWith(
      { err: fehler, pageId: "p1" },
      "Doc-Reset nicht uebernommen: Nonce nicht belegbar, keine Quittung",
    );
  });

  it("meldet eine nicht abgelegte Quittung, statt zu werfen", async () => {
    const fehler = new Error("Connection is closed.");
    const { deps, handle } = setup({
      acknowledge: vi.fn().mockRejectedValue(fehler),
    });
    await expect(handle(MESSAGE)).resolves.toBeUndefined();
    expect(deps.log.warn).toHaveBeenCalledWith(
      { err: fehler, pageId: "p1" },
      "Quittung des Doc-Resets nicht abgelegt",
    );
  });
});
