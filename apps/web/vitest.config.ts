import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // "server-only" ist ein RSC-Guard und in Unit-Tests bedeutungslos.
      "server-only": fileURLToPath(
        new URL("./test/server-only-stub.ts", import.meta.url),
      ),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@dokunc/editor": fileURLToPath(
        new URL("../../packages/editor/src/index.ts", import.meta.url),
      ),
    },
  },
});
