import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import { promises as fsp } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DocsClient } from "@tmhs/rs3-devtools-core";
import { createServer } from "../server.js";
import { PROMPT_NAMES, TOOL_ANNOTATIONS } from "../annotations.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const coreFixtures = fileURLToPath(new URL("../../../core/src/__tests__/fixtures/plugins/", import.meta.url));

let workspace: string;
let devRoot: string;
let client: Client;

async function callTool(name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
  const text = result.content.map((c) => c.text).join("\n");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { isError: Boolean(result.isError), text, json: json as Record<string, unknown> | undefined };
}

beforeEach(async () => {
  workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "rs3-mcp-ws-"));
  devRoot = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), "rs3-mcp-dev-")), "dev_plugins");
  await fsp.mkdir(devRoot);
  await fsp.cp(path.join(coreFixtures, "clean"), path.join(workspace, "clean"), { recursive: true });
  const server = await createServer({
    workspaceRoot: workspace,
    indexPath: path.join(fixtures, "index.json"),
    devPluginsRoot: devRoot,
    docsClient: new DocsClient({ offlineDir: path.join(fixtures, "docs"), baseUrl: "https://example.test/rs/" }),
    version: "0.0.0-test",
    docsIndexPath: path.join(workspace, ".cache", "docs-index.json"),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
  await fsp.rm(workspace, { recursive: true, force: true });
  await fsp.rm(path.dirname(devRoot), { recursive: true, force: true });
});

describe("rs3-plugin-mcp", () => {
  it("lists the nine tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "api_lookup",
      "devplugins_sync",
      "docs_get",
      "docs_index",
      "docs_search",
      "guidelines_preflight",
      "manifest_validate",
      "package_zip",
      "plugin_scaffold",
    ]);
  });

  it("sends instructions, annotations, prompts and resources", async () => {
    expect(client.getInstructions()).toContain("loadstring");
    const { tools } = await client.listTools();
    for (const tool of tools) expect(tool.annotations, tool.name).toEqual(TOOL_ANNOTATIONS[tool.name]);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([...PROMPT_NAMES].sort());
    const newPlugin = await client.getPrompt({ name: "new_plugin", arguments: { name: "loot-tally", permissions: "chatAccess" } });
    const text = newPlugin.messages[0]!.content as { type: string; text: string };
    expect(text.text).toContain('plugin_scaffold with path "loot-tally"');
    expect(text.text).toContain('"chatAccess"');
    const fix = await client.getPrompt({ name: "fix_preflight", arguments: { path: "clean" } });
    expect((fix.messages[0]!.content as { text: string }).text).toContain("guidelines_preflight");
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(expect.arrayContaining(["rs3://stubs/index.json", "rs3://stubs/unresolved.md"]));
    const index = await client.readResource({ uri: "rs3://stubs/index.json" });
    expect(JSON.parse(String(index.contents[0]!.text)).symbols.length).toBeGreaterThan(0);
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toContain("rs3://stubs/modules/{+id}");
    const mod = await client.readResource({ uri: "rs3://stubs/modules/core/sample" });
    expect(String(mod.contents[0]!.text)).toContain("---@meta");
  });

  it("docs_index builds the full-text index and docs_search returns sections by words", async () => {
    const before = await callTool("docs_search", { query: "synthetic admonition" });
    expect(before.json!.sections).toBeUndefined();
    const built = await callTool("docs_index", {});
    expect(built.isError).toBe(false);
    expect(built.json!.pages).toBe(2);
    expect(Number(built.json!.sections)).toBeGreaterThan(3);
    const after = await callTool("docs_search", { query: "synthetic admonition body" });
    const sections = after.json!.sections as { page: string; heading: string; url: string; excerpt: string }[];
    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0]!.page).toBe("core/shapes");
    expect(sections[0]!.url).toContain("core/shapes.html#");
    expect(sections[0]!.excerpt).toContain("admonition");
  });

  it("devplugins_sync dry_run lists the files a real sync would copy and remove", async () => {
    await fsp.mkdir(path.join(devRoot, "clean"), { recursive: true });
    await fsp.writeFile(path.join(devRoot, "clean", "plugin.json"), "{}");
    await fsp.writeFile(path.join(devRoot, "clean", "stale.lua"), "-- old");
    const dry = await callTool("devplugins_sync", { path: "clean", dry_run: true });
    expect(dry.isError).toBe(false);
    expect(dry.json!.dryRun).toBe(true);
    expect(dry.json!.copied).toEqual(["lib/helpers.lua", "main.lua", "plugin.json"]);
    expect(dry.json!.removed).toEqual(["stale.lua"]);
    expect(await fsp.readFile(path.join(devRoot, "clean", "stale.lua"), "utf8")).toBe("-- old");
  });

  it("api_lookup returns signature and docs url", async () => {
    const r = await callTool("api_lookup", { name: "Sample:Get" });
    expect(r.isError).toBe(false);
    const matches = r.json!.matches as { signature: string; url: string }[];
    expect(matches[0]!.signature).toContain("function Sample:Get");
    expect(matches[0]!.url).toContain("#get");
    const miss = await callTool("api_lookup", { name: "DoesNotExist", exact: true });
    expect(miss.isError).toBe(true);
  });

  it("docs_search ranks exact names first and lists pages", async () => {
    const r = await callTool("docs_search", { query: "sample" });
    const symbols = r.json!.symbols as { name: string }[];
    expect(symbols[0]!.name).toBe("Sample");
    expect((r.json!.pages as unknown[]).length).toBeGreaterThan(0);
  });

  it("docs_get fetches a page offline and can narrow to a section", async () => {
    const full = await callTool("docs_get", { url: "core/sample.html" });
    expect(full.isError).toBe(false);
    expect(full.json!.title).toBe("Sample");
    const section = await callTool("docs_get", { url: "core/sample.html", section: "get" });
    expect(String(section.json!.text)).toContain("### Get");
    expect(String(section.json!.text)).not.toContain("### Make");
    const missing = await callTool("docs_get", { url: "core/sample.html", section: "nope" });
    expect(missing.isError).toBe(true);
  });

  it("docs_get slices repeated headings by anchor and refuses an ambiguous heading", async () => {
    const ambiguous = await callTool("docs_get", { url: "core/shapes.html", section: "Properties" });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain("DOCS_SECTION");
    expect(ambiguous.text).toContain("properties_1");
    const second = await callTool("docs_get", { url: "core/shapes.html", section: "#properties_1" });
    expect(second.isError).toBe(false);
    const text = String(second.json!.text);
    expect(text.startsWith("### Properties")).toBe(true);
    expect(text).toContain("- outer one");
    expect(text).toContain("  - inner `x`");
    expect(text).not.toContain("alpha identifier");
    expect(text).not.toContain("Gamma");
    const beta = await callTool("docs_get", { url: "core/shapes.html", section: "beta" });
    const betaText = String(beta.json!.text);
    expect(betaText).toContain("**Info**");
    expect(betaText).toContain("Synthetic admonition body.");
    expect(betaText).toContain("| Get | `Get(key : String)` |");
    expect(betaText).not.toContain("Last section");
    const alpha = await callTool("docs_get", { url: "core/shapes.html", section: "alpha" });
    expect(String(alpha.json!.text)).toContain("- `id`\n  Synthetic alpha identifier.");
  });

  it("manifest_validate and guidelines_preflight read workspace plugins only", async () => {
    const ok = await callTool("manifest_validate", { path: "clean" });
    expect((ok.json!.summary as { errors: number }).errors).toBe(0);
    const pre = await callTool("guidelines_preflight", { path: "clean" });
    expect(pre.json!.ok).toBe(true);
    // ignore drops codes and reports them as suppressed.
    const ignored = await callTool("guidelines_preflight", { path: "clean", ignore: ["placeholder-email"] });
    expect((ignored.json!.findings as { code: string }[]).some((f) => f.code === "placeholder-email")).toBe(false);
    expect((ignored.json!.suppressed as { code: string }[]).map((f) => f.code)).toContain("placeholder-email");
    const outside = await callTool("guidelines_preflight", { path: path.join(coreFixtures, "sandbox") });
    expect(outside.isError).toBe(true);
    expect(outside.text).toContain("PATH_DENIED");
  });

  it("devplugins_sync requires confirm and supports dry_run", async () => {
    const dry = await callTool("devplugins_sync", { path: "clean", dry_run: true });
    expect(dry.json!.dryRun).toBe(true);
    const refused = await callTool("devplugins_sync", { path: "clean" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("CONFIRM_REQUIRED");
    const done = await callTool("devplugins_sync", { path: "clean", confirm: true });
    expect(done.isError).toBe(false);
    expect(done.json!.consoleCommand).toBe("prl clean");
    expect(await fsp.stat(path.join(devRoot, "clean", "main.lua"))).toBeTruthy();
  });

  it("plugin_scaffold writes inside the workspace only", async () => {
    const made = await callTool("plugin_scaffold", { path: "new-plugin", permissions: ["chatAccess"], agentFiles: false });
    expect(made.isError).toBe(false);
    expect(await fsp.stat(path.join(workspace, "new-plugin", "main.lua"))).toBeTruthy();
    const outside = await callTool("plugin_scaffold", { path: path.join(os.tmpdir(), "rs3-escape-" + Date.now()) });
    expect(outside.isError).toBe(true);
    expect(outside.text).toContain("PATH_DENIED");
  });

  it("package_zip refuses when preflight fails and writes into dist otherwise", async () => {
    await fsp.cp(path.join(coreFixtures, "sandbox"), path.join(workspace, "sandbox"), { recursive: true });
    const bad = await callTool("package_zip", { path: "sandbox" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("PREFLIGHT");
    // The clean fixture carries an example.com address, so packaging needs the test-only flag.
    const placeholder = await callTool("package_zip", { path: "clean" });
    expect(placeholder.isError).toBe(true);
    expect(placeholder.text).toContain("placeholder-email");
    const good = await callTool("package_zip", { path: "clean", allowPlaceholderEmail: true });
    expect(good.isError).toBe(false);
    expect(String(good.json!.outFile)).toContain(path.join(workspace, "dist"));
    const escape = await callTool("package_zip", { path: "clean", outFile: path.join(os.tmpdir(), "escape.zip"), allowPlaceholderEmail: true });
    expect(escape.isError).toBe(true);
  });
});
