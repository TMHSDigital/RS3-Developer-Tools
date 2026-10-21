import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { promises as fsp } from "node:fs";
import { listFiles, parseFrontmatter, readJson, readText, repoRoot } from "./helpers.js";

interface PluginManifest {
  rules: string[];
}

describe("cursor-plugin rules", async () => {
  const manifest = await readJson<PluginManifest>(".cursor-plugin/plugin.json");
  const ruleFiles = await listFiles(path.join(repoRoot, "cursor-plugin", "rules"), (rel) => rel.endsWith(".mdc"));

  it("every rule is named rs3-<topic>.mdc and listed in plugin.json", () => {
    expect(ruleFiles.length).toBeGreaterThan(0);
    for (const rel of ruleFiles) {
      expect(rel).toMatch(/^rs3-[a-z0-9-]+\.mdc$/);
      expect(manifest.rules).toContain(`cursor-plugin/rules/${rel}`);
    }
    expect(manifest.rules.length).toBe(ruleFiles.length);
  });

  for (const rel of ruleFiles) {
    it(`${rel} has valid frontmatter and stays under 100 lines`, async () => {
      const text = await readText(`cursor-plugin/rules/${rel}`);
      const { data, body } = parseFrontmatter(text);
      expect(typeof data.description).toBe("string");
      expect((data.description as string).length).toBeLessThan(200);
      expect(Array.isArray(data.globs)).toBe(true);
      expect(typeof data.alwaysApply).toBe("boolean");
      if (data.alwaysApply === false) expect((data.globs as string[]).length).toBeGreaterThan(0);
      for (const glob of data.globs as string[]) expect(glob).toMatch(/^\*\*\//);
      expect(data["standards-version"]).toMatch(/^\d+\.\d+\.\d+$/);
      expect(text.split("\n").length).toBeLessThan(100);
      expect(body).toMatch(/^# /m);
      expect(body).toContain("## Rules");
    });
  }

  it("ships the secrets rule required by the ecosystem standard", () => {
    expect(ruleFiles).toContain("rs3-secrets.mdc");
  });

  it("every manifest rule path exists", async () => {
    for (const rel of manifest.rules) {
      await expect(fsp.stat(path.join(repoRoot, rel))).resolves.toBeTruthy();
    }
  });
});
