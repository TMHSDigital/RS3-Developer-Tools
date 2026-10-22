import { describe, expect, it } from "vitest";
import { PROMPT_NAMES, TOOL_ANNOTATIONS } from "../packages/mcp/src/annotations.js";
import { readJson, readText } from "./helpers.js";

interface McpTools {
  server: string;
  tools: {
    name: string;
    description: string;
    category: string;
    destructive: boolean;
    requiresConfirm: boolean;
    annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  }[];
  prompts: { name: string; description: string }[];
  resources: { uri: string; description: string }[];
}

const EXPECTED_TOOLS = [
  "docs_search",
  "docs_get",
  "docs_index",
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

  it("annotations agree with the table the server sends", () => {
    expect(Object.keys(TOOL_ANNOTATIONS).sort()).toEqual(EXPECTED_TOOLS);
    for (const tool of data.tools) {
      expect(tool.annotations, tool.name).toEqual(TOOL_ANNOTATIONS[tool.name]);
      expect(tool.annotations.destructiveHint, tool.name).toBe(tool.destructive);
      if (tool.annotations.readOnlyHint) expect(tool.annotations.destructiveHint, tool.name).toBe(false);
    }
  });

  it("matches the tool, prompt and resource names registered in the server source", async () => {
    const source = await readText("packages/mcp/src/server.ts");
    const registered = [...source.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(registered).toEqual(EXPECTED_TOOLS);
    const prompts = [...source.matchAll(/registerPrompt\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(prompts).toEqual([...PROMPT_NAMES].sort());
    expect(data.prompts.map((p) => p.name).sort()).toEqual([...PROMPT_NAMES].sort());
    const resources = [...source.matchAll(/registerResource\(\s*"([a-z_-]+)"/g)].map((m) => m[1]);
    expect(resources.length).toBe(data.resources.length);
    for (const r of data.resources) expect(r.uri.startsWith("rs3://stubs/")).toBe(true);
  });
});

describe("server instructions", () => {
  it("state the same rules as the workspace AGENTS.md", async () => {
    const { SERVER_INSTRUCTIONS } = await import("../packages/mcp/src/instructions.js");
    const agents = await readText("cursor-plugin/AGENTS.md");
    for (const phrase of [
      "loadstring",
      "Plugin.HasPermission",
      "PluginShutdown",
      "display name",
      "contactEmailAddress",
      "copyright Jagex",
      "developer.runescape.com",
      "mod.io",
    ]) {
      expect(SERVER_INSTRUCTIONS, phrase).toContain(phrase);
      expect(agents, phrase).toContain(phrase);
    }
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(4000);
  });
});
