import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import { promises as fsp } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DocsClient } from "@tmhs/rs3-devtools-core";
import { createServer } from "../server.js";

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
  it("lists the eight tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "api_lookup",
      "devplugins_sync",
      "docs_get",
      "docs_search",
      "guidelines_preflight",
      "manifest_validate",
      "package_zip",
      "plugin_scaffold",
    ]);
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
