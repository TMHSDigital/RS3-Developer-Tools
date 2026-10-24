// One vitest run for the repository tests and every workspace package, so
// `npm test` is a single process with a single coverage report. Each package
// still has its own `npm test` for focused runs.
import { defineConfig } from "vitest/config";

const packages = ["schema", "core", "stubs-generator", "cli", "mcp", "vscode"];

export default defineConfig({
  test: {
    projects: [
      { test: { name: "repo", root: ".", include: ["tests/**/*.test.ts"] } },
      ...packages.map((name) => ({ test: { name, root: `packages/${name}`, include: ["src/**/*.test.ts"] } })),
    ],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["packages/*/src/**/*.ts", "scripts/*.mjs"],
      exclude: ["**/__tests__/**", "**/*.d.ts"],
      // Measured on 2026-10-22 (lines 75, statements 73, functions 74, branches 63) and set a
      // little below, so a real drop fails CI while small refactors pass. Raise them as tests land.
      thresholds: { lines: 72, statements: 70, functions: 71, branches: 60 },
    },
  },
});
