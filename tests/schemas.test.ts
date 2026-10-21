import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { listFiles, readJson, readText, repoRoot } from "./helpers.js";

interface CursorManifest {
  name: string;
  displayName: string;
  description: string;
  version: string;
  author: { name: string; email: string };
  license: string;
  keywords: string[];
  skills: string[];
  rules: string[];
}

describe("repository manifests", () => {
  it(".cursor-plugin/plugin.json has every required field", async () => {
    const m = await readJson<CursorManifest>(".cursor-plugin/plugin.json");
    for (const field of ["name", "displayName", "description", "version", "author", "license", "keywords", "skills", "rules"]) {
      expect(m).toHaveProperty(field);
    }
    expect(m.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(m.license).toBe("MIT");
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("site.json parses and carries the repository link", async () => {
    const site = await readJson<{ links: { github: string } }>("site.json");
    expect(site.links.github).toContain("TMHSDigital/RS3-Developer-Tools");
  });

  it("README stat counts match the files on disk", async () => {
    const readme = await readText("README.md");
    const skills = (await listFiles(path.join(repoRoot, "cursor-plugin", "skills"), (r) => r.endsWith("SKILL.md"))).length;
    const rules = (await listFiles(path.join(repoRoot, "cursor-plugin", "rules"), (r) => r.endsWith(".mdc"))).length;
    const tools = (await readJson<{ tools: unknown[] }>("mcp-tools.json")).tools.length;
    expect(readme).toContain(`${skills} skills`);
    expect(readme).toContain(`${rules} rules`);
    expect(readme).toContain(`${tools} MCP tools`);
  });

  it("every workspace package is MIT licensed and versioned together", async () => {
    const root = await readJson<{ workspaces: string[]; version: string }>("package.json");
    for (const ws of root.workspaces) {
      const pkg = await readJson<{ license: string; version: string; name: string }>(`${ws}/package.json`);
      expect(pkg.license, pkg.name).toBe("MIT");
      expect(pkg.version, pkg.name).toBe(root.version);
    }
  });

  it("the example plugin manifest validates against the schema", async () => {
    const { Ajv2020 } = await import("ajv/dist/2020.js");
    const formats = (await import("ajv-formats")) as unknown as { default: (ajv: unknown) => unknown };
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    (formats.default as unknown as (a: unknown) => void)(ajv);
    const validate = ajv.compile(await readJson("packages/schema/plugin.schema.json"));
    expect(validate(await readJson("examples/hello-counter/plugin.json"))).toBe(true);
  });
});
