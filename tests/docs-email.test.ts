import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { isPlaceholderEmail } from "../packages/core/src/manifest.js";
import { listFiles, readText, repoRoot } from "./helpers.js";

// The quick start, the CLI README and the skills must not tell the reader to
// scaffold with an address that rs3dev package then refuses (#7). A value in
// angle brackets is a prompt for the reader's own address and is fine.

async function docFiles(): Promise<string[]> {
  const skills = (await listFiles(path.join(repoRoot, "cursor-plugin", "skills"), (rel) => rel.endsWith("SKILL.md"))).map(
    (rel) => `cursor-plugin/skills/${rel}`,
  );
  const rules = (await listFiles(path.join(repoRoot, "cursor-plugin", "rules"), (rel) => rel.endsWith(".mdc"))).map((rel) => `cursor-plugin/rules/${rel}`);
  return ["README.md", "packages/cli/README.md", "packages/mcp/README.md", "AGENTS.md", ...skills, ...rules];
}

describe("documented --email values", async () => {
  const files = await docFiles();
  for (const rel of files) {
    it(`${rel} never passes a placeholder address to --email`, async () => {
      const text = await readText(rel);
      const matches = [...text.matchAll(/--email\s+(\S+)/g)].map((m) => m[1]!.replace(/[`\]]+$/, ""));
      for (const value of matches) {
        if (/^<[^>]+>$/.test(value)) continue;
        expect(isPlaceholderEmail(value), `${rel}: --email ${value}`).toBe(false);
      }
    });
  }
});
