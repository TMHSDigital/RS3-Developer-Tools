import { describe, expect, it } from "vitest";
import { readJson, readText } from "./helpers.js";

interface McpTools {
  server: string;
  tools: { name: string; description: string; category: string; destructive: boolean; requiresConfirm: boolean }[];
}

const EXPECTED_TOOLS = [
  "docs_search",
  "docs_get",
  "manifest_validate",
  "plugin_scaffold",
  "devplugins_sync",
  "guidelines_preflight",
  "package_zip",
  "api_lookup",
].sort();

describe("mcp-tools.json", async () => {
  const data = await readJson<McpTools>("mcp-tools.json");

  it("lists exactly the tools the server registers", () => {
    expect(data.tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS);
  });

  it("every tool has an imperative one-sentence description and consistent flags", () => {
    for (const tool of data.tools) {
      expect(tool.description.length).toBeLessThan(200);
      expect(/^[A-Z][a-z]+ /.test(tool.description)).toBe(true);
      expect(typeof tool.category).toBe("string");
      expect(tool.requiresConfirm).toBe(tool.destructive);
    }
  });

  it("marks devplugins_sync as the only destructive tool", () => {
    const destructive = data.tools.filter((t) => t.destructive).map((t) => t.name);
    expect(destructive).toEqual(["devplugins_sync"]);
  });

  it("matches the tool names registered in the server source", async () => {
    const source = await readText("packages/mcp/src/server.ts");
    const registered = [...source.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(registered).toEqual(EXPECTED_TOOLS);
  });
});
