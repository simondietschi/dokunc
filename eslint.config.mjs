import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";

/**
 * Flache ESLint-Konfiguration fuer das gesamte Monorepo.
 *
 * Bewusst ohne typgestuetzte Regeln: die brauchen ein Programm pro
 * Paket und machen den Lauf um ein Vielfaches langsamer. Was hier
 * greift, faengt die Klasse von Fehlern ab, die der Typechecker nicht
 * sieht (vergessene Hook-Abhaengigkeiten, tote Variablen).
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/next-env.d.ts",
      // Generierter Prisma-Client: fremder Code, nicht unser Stil.
      "packages/db/src/generated/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Unterstrich-Praefix heisst "absichtlich ungenutzt".
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      // Leerer catch-Block ist im Code eine bewusste Aussage
      // ("Fehlschlag ist hier egal") und immer kommentiert.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "@next/next": nextPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,

      // Diagramm-Vorschauen sind data:-URLs aus dem Editor. next/image
      // kann daran nichts optimieren und braeuchte feste Masse.
      "@next/next/no-img-element": "off",

      // Zwei Regeln aus react-hooks 7, die auf legitime Muster
      // anschlagen: das Mount-Flag, mit dem Portale erst nach der
      // Hydration rendern, und Date.now() in Server-Komponenten (die
      // Regeln kennen die Server-Grenze nicht). Als Hinweis behalten,
      // aber nicht als Gate — sonst muesste korrekter Code weichen.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },

  {
    // Playwright-Specs laufen in Node, nicht im Browser-Bundle.
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    languageOptions: { globals: globals.node },
  },
);
