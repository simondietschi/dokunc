import { describe, expect, it } from "vitest";
import { Prisma } from "@dokunc/db";
import { isConflictNotice, isSerializationConflict } from "./concurrent-change";

function known(code: string) {
  return new Prisma.PrismaClientKnownRequestError("x", {
    code,
    clientVersion: "test",
  });
}

/** So reicht Prisma 7 mit dem pg-Adapter einen Konflikt beim COMMIT durch. */
function adapterError(kind: string) {
  const e = new Error(kind, { cause: { kind, originalCode: "40001" } });
  e.name = "DriverAdapterError";
  return e;
}

describe("isSerializationConflict()", () => {
  it("erkennt P2034 aus einer Abfrage", () => {
    expect(isSerializationConflict(known("P2034"))).toBe(true);
  });

  it("erkennt den unuebersetzten Konflikt beim COMMIT", () => {
    expect(isSerializationConflict(adapterError("TransactionWriteConflict"))).toBe(
      true,
    );
  });

  it("laesst andere Fehler durch", () => {
    expect(isSerializationConflict(known("P2002"))).toBe(false);
    expect(isSerializationConflict(adapterError("UniqueConstraintViolation"))).toBe(
      false,
    );
    expect(isSerializationConflict(new Error("TransactionWriteConflict"))).toBe(
      false,
    );
    expect(isSerializationConflict(undefined)).toBe(false);
  });
});

describe("isConflictNotice()", () => {
  it("nimmt nur den festen Wert an", () => {
    expect(isConflictNotice("1")).toBe(true);
    for (const roh of ["", "0", "ja", undefined, ["1"]]) {
      expect(isConflictNotice(roh)).toBe(false);
    }
  });
});
