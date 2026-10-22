import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { listFiles, parseFrontmatter, readJson, readText, repoRoot } from "./helpers.js";

interface PluginManifest {
  skills: string[];
  rules: string[];
}

describe("cursor-plugin skills", async () => {
  const manifest = await readJson<PluginManifest>(".cursor-plugin/plugin.json");
  const skillFiles = await listFiles(path.join(repoRoot, "cursor-plugin", "skills"), (rel) => rel.endsWith("SKILL.md"));

  it("every skill folder has a SKILL.md listed in plugin.json", () => {
    expect(skillFiles.length).toBeGreaterThan(0);
    for (const rel of skillFiles) {
      expect(manifest.skills).toContain(`cursor-plugin/skills/${rel}`);
    }
    expect(manifest.skills.length).toBe(skillFiles.length);
  });

  for (const rel of skillFiles) {
    it(`${rel} has valid frontmatter and stays under 250 lines`, async () => {
      const text = await readText(`cursor-plugin/skills/${rel}`);
      const { data, body } = parseFrontmatter(text);
      const folder = rel.split("/")[0];
      expect(data.name).toBe(folder);
      expect(typeof data.description).toBe("string");
      expect((data.description as string).length).toBeLessThan(200);
      expect(/^[A-Z][a-z]+\b/.test(data.description as string)).toBe(true);
      const triggers = data.triggers as string[];
      expect(Array.isArray(triggers)).toBe(true);
      expect(triggers.length).toBeGreaterThanOrEqual(3);
      expect(triggers.length).toBeLessThanOrEqual(8);
      expect(data["standards-version"]).toMatch(/^\d+\.\d+\.\d+$/);
      expect(text.split("\n").length).toBeLessThan(250);
      for (const heading of ["## When to use", "## When NOT to use", "## Steps"]) {
        expect(body).toContain(heading);
      }
    });
  }

  it("every manifest skill path exists", async () => {
    for (const rel of manifest.skills) {
      await expect(fsp.stat(path.join(repoRoot, rel))).resolves.toBeTruthy();
    }
  });
});
