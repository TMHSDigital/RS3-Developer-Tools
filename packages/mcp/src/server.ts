// @tmhs/rs3-plugin-mcp: MCP server for RuneScape 3 plugin development.
//
// Tools wrap the same core functions as the rs3dev CLI. Every tool that writes
// takes an explicit path and refuses anything outside the workspace root or
// the client's dev_plugins root. Documentation is fetched live and cached in
// the per-user cache folder; the server never indexes any plugin code other
// than the files inside the workspace it was started for.

import * as path from "node:path";
import { promises as fsp } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DocsClient,
  PERMISSIONS,
  docsPageToText,
  findDevPluginsRoot,
  isInside,
  packagePlugin,
  preflightPlugin,
  readUtf8,
  scaffoldPlugin,
  stubsIndexPath,
  summarise,
  syncPlugin,
  validatePluginDir,
  type Finding,
  type Permission,
} from "@tmhs/rs3-devtools-core";

export const SERVER_NAME = "rs3-plugin-mcp";

export interface ServerOptions {
  /** Folder the agent is allowed to read plugins from and write into. */
  workspaceRoot: string;
  /** Path to the stubs index.json; resolved from @tmhs/rs3-luals-stubs when omitted. */
  indexPath?: string;
  docsClient?: DocsClient;
  /** Explicit dev_plugins root (tests); otherwise RS3_DEV_PLUGINS_DIR or detection. */
  devPluginsRoot?: string;
  version?: string;
}

interface IndexSymbol {
  name: string;
  kind: string;
  module: string;
  file: string;
  url: string;
  signature: string;
}
interface StubsIndex {
  baseUrl: string;
  modules: { id: string; title: string; url: string; file: string }[];
  symbols: IndexSymbol[];
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}
function fail(code: string, message: string): ToolResult {
  return { isError: true, content: [{ type: "text", text: `[${code}] ${message}` }] };
}

function findingsPayload(label: string, findings: Finding[]) {
  return { command: label, summary: summarise(findings), ok: summarise(findings).errors === 0, findings };
}

export async function createServer(options: ServerOptions): Promise<McpServer> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const docs = options.docsClient ?? new DocsClient({ maxAgeSeconds: 300 });
  const server = new McpServer({ name: SERVER_NAME, version: options.version ?? "0.0.0" });

  let indexCache: StubsIndex | undefined;
  const loadIndex = async (): Promise<StubsIndex> => {
    if (indexCache) return indexCache;
    const file = options.indexPath ?? (await stubsIndexPath());
    indexCache = JSON.parse(await readUtf8(file)) as StubsIndex;
    return indexCache;
  };

  const resolveDevRoot = async (override?: string): Promise<string> =>
    (await findDevPluginsRoot({ override: override ?? options.devPluginsRoot })).root;

  /** A path may be read when it is inside the workspace or inside dev_plugins. */
  const checkReadable = async (target: string): Promise<string | undefined> => {
    const resolved = path.resolve(workspaceRoot, target);
    if (isInside(workspaceRoot, resolved)) return undefined;
    try {
      const devRoot = await resolveDevRoot();
      if (isInside(devRoot, resolved)) return undefined;
    } catch {
      // No dev_plugins root available; only the workspace counts.
    }
    return `${resolved} is outside the workspace (${workspaceRoot}) and the dev_plugins root; this server only reads the plugins you are developing`;
  };
  const checkWritable = async (target: string): Promise<string | undefined> => {
    const resolved = path.resolve(workspaceRoot, target);
    if (isInside(workspaceRoot, resolved)) return undefined;
    try {
      const devRoot = await resolveDevRoot();
      if (isInside(devRoot, resolved)) return undefined;
    } catch {
      // fall through
    }
    return `refusing to write to ${resolved}: outside the workspace (${workspaceRoot}) and the dev_plugins root`;
  };

  server.registerTool(
    "docs_search",
    {
      title: "Search the RuneScape Client API docs",
      description: "Search API symbols and documentation pages by name. Returns matching symbols with their signature and the exact docs URL.",
      inputSchema: {
        query: z.string().min(1).describe("Symbol or page name, for example PersistentDB, ui.Button, NPCEntityAdded"),
        limit: z.number().int().min(1).max(50).default(15),
      },
    },
    async ({ query, limit }) => {
      const index = await loadIndex();
      const q = query.toLowerCase();
      const score = (name: string): number => {
        const n = name.toLowerCase();
        if (n === q) return 0;
        if (n.endsWith("." + q) || n.endsWith(":" + q)) return 1;
        if (n.startsWith(q)) return 2;
        if (n.includes(q)) return 3;
        return -1;
      };
      const symbols = index.symbols
        .map((s) => ({ s, rank: score(s.name) }))
        .filter((x) => x.rank >= 0)
        .sort((a, b) => a.rank - b.rank || a.s.name.localeCompare(b.s.name))
        .slice(0, limit)
        .map(({ s }) => ({ name: s.name, kind: s.kind, signature: s.signature, url: s.url }));
      const pages = index.modules
        .filter((m) => m.title.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
        .slice(0, 10)
        .map((m) => ({ page: m.id, title: m.title, url: m.url }));
      return ok({ query, symbols, pages, hint: "Use docs_get with a url to read the page text." });
    },
  );

  server.registerTool(
    "docs_get",
    {
      title: "Fetch a documentation page",
      description: "Fetch a developer.runescape.com page (live, with a local ETag cache) and return its text. Optionally restrict to one section by heading or anchor.",
      inputSchema: {
        url: z.string().min(1).describe("Full URL or path such as core/persistentdb.html"),
        section: z.string().optional().describe("Heading text or anchor id to return only that section"),
        maxChars: z.number().int().min(500).max(60000).default(16000),
      },
    },
    async ({ url, section, maxChars }) => {
      let page;
      try {
        page = await docs.getPage(url);
      } catch (error) {
        return fail("DOCS_FETCH", (error as Error).message);
      }
      const text = docsPageToText(page.html);
      let body = text.text;
      if (section) {
        const wanted = section.replace(/^#/, "").toLowerCase();
        const idx = text.sections.findIndex((s) => s.anchor.toLowerCase() === wanted || s.heading.toLowerCase() === wanted);
        if (idx === -1) return fail("DOCS_SECTION", `no section "${section}" on ${page.url}; available: ${text.sections.map((s) => s.anchor).join(", ")}`);
        const start = text.sections[idx]!;
        const next = text.sections.slice(idx + 1).find((s) => s.level <= start.level);
        const lines = body.split("\n");
        const startLine = lines.findIndex((l) => l === `${"#".repeat(start.level)} ${start.heading}`);
        const endLine = next ? lines.findIndex((l, i) => i > startLine && l === `${"#".repeat(next.level)} ${next.heading}`) : -1;
        body = lines.slice(startLine, endLine === -1 ? undefined : endLine).join("\n");
      }
      const truncated = body.length > maxChars;
      if (truncated) body = body.slice(0, maxChars) + `\n\n[truncated; ${body.length} characters total. Pass a section or a larger maxChars.]`;
      return ok({ url: page.url, title: text.title, source: page.source, sections: text.sections.map((s) => s.anchor), text: body, copyright: "Documentation content is copyright Jagex; link to it rather than copying it into plugins or repositories." });
    },
  );

  server.registerTool(
    "api_lookup",
    {
      title: "Look up an API signature",
      description: "Return the LuaLS signature, kind, stub file and docs URL for an API symbol such as PersistentDB:Get or Event.NPCEntityAdded.",
      inputSchema: {
        name: z.string().min(1).describe("Symbol name; dotted or colon form, case-insensitive"),
        exact: z.boolean().default(false).describe("Only return exact matches"),
      },
    },
    async ({ name, exact }) => {
      const index = await loadIndex();
      const q = name.toLowerCase().replace(/:/g, ".");
      const norm = (s: string) => s.toLowerCase().replace(/:/g, ".");
      const exactMatches = index.symbols.filter((s) => norm(s.name) === q);
      const matches = exact
        ? exactMatches
        : exactMatches.length > 0
          ? exactMatches
          : index.symbols.filter((s) => norm(s.name).endsWith("." + q) || norm(s.name).includes(q)).slice(0, 25);
      if (matches.length === 0) return fail("NOT_FOUND", `no symbol matches "${name}"; try docs_search`);
      return ok({ query: name, matches: matches.map((s) => ({ name: s.name, kind: s.kind, signature: s.signature, stubFile: s.file, url: s.url })) });
    },
  );

  server.registerTool(
    "manifest_validate",
    {
      title: "Validate plugin.json",
      description: "Validate a plugin folder's plugin.json against the schema and check the folder structure (main.lua, require paths, BOM).",
      inputSchema: { path: z.string().min(1).describe("Plugin folder (or its plugin.json), absolute or relative to the workspace") },
    },
    async ({ path: target }) => {
      const denied = await checkReadable(target);
      if (denied) return fail("PATH_DENIED", denied);
      let dir = path.resolve(workspaceRoot, target);
      if (dir.toLowerCase().endsWith("plugin.json")) dir = path.dirname(dir);
      const { findings } = await validatePluginDir(dir);
      return ok(findingsPayload("manifest_validate", findings));
    },
  );

  server.registerTool(
    "guidelines_preflight",
    {
      title: "Preflight a plugin against the submission guidelines",
      description: "Static checks for sandbox-forbidden globals, permission use without declaration, URLs outside the manifest, missing contact email and minified or obfuscated code. Each finding links the relevant docs page.",
      inputSchema: { path: z.string().min(1).describe("Plugin folder, absolute or relative to the workspace") },
    },
    async ({ path: target }) => {
      const denied = await checkReadable(target);
      if (denied) return fail("PATH_DENIED", denied);
      const result = await preflightPlugin(path.resolve(workspaceRoot, target));
      return ok({ ...findingsPayload("guidelines_preflight", result.findings), filesChecked: result.files });
    },
  );

  server.registerTool(
    "plugin_scaffold",
    {
      title: "Scaffold a new plugin",
      description: "Create a new plugin folder with a commented main.lua, plugin.json, .luarc.json and agent guidance files. Writes only inside the workspace and never overwrites existing files.",
      inputSchema: {
        path: z.string().min(1).describe("Folder to create; its basename is the plugin identifier"),
        name: z.string().optional().describe("Display name for plugin.json (defaults to the folder name)"),
        permissions: z.array(z.enum(PERMISSIONS)).default([]).describe("Optional permissions, gated with Plugin.HasPermission in main.lua"),
        requiredPermissions: z.array(z.enum(PERMISSIONS)).default([]),
        prettyUi: z.boolean().default(false).describe("Add PrettyUI as a required dependency"),
        contactEmail: z.string().email().optional(),
        agentFiles: z.boolean().default(true).describe("Copy AGENTS.md, Cursor rules and Claude Code skills"),
        force: z.boolean().default(false).describe("Allow a non-empty folder; existing files are kept"),
      },
    },
    async (input) => {
      const denied = await checkWritable(input.path);
      if (denied) return fail("PATH_DENIED", denied);
      try {
        const result = await scaffoldPlugin({
          dir: path.resolve(workspaceRoot, input.path),
          name: input.name,
          permissions: input.permissions as Permission[],
          requiredPermissions: input.requiredPermissions as Permission[],
          prettyUi: input.prettyUi,
          contactEmail: input.contactEmail,
          agentFiles: input.agentFiles,
          force: input.force,
        });
        return ok({ ...result, next: [`rs3dev sync ${result.pluginName}`, `console: prf, pon ${result.pluginName}`] });
      } catch (error) {
        return fail("SCAFFOLD", (error as Error).message);
      }
    },
  );

  server.registerTool(
    "devplugins_sync",
    {
      title: "Copy a plugin into dev_plugins",
      description: "Copy the plugin folder into the client's dev_plugins root (overwriting the previous copy) and return the console reload command. Requires confirm=true; dry_run lists what would change.",
      inputSchema: {
        path: z.string().min(1).describe("Plugin folder, absolute or relative to the workspace"),
        root: z.string().optional().describe("dev_plugins folder; defaults to RS3_DEV_PLUGINS_DIR or client detection"),
        confirm: z.boolean().default(false).describe("Must be true to perform the copy"),
        dry_run: z.boolean().default(false).describe("Report the destination and files without copying"),
      },
    },
    async ({ path: target, root, confirm, dry_run }) => {
      const denied = await checkReadable(target);
      if (denied) return fail("PATH_DENIED", denied);
      const source = path.resolve(workspaceRoot, target);
      if (dry_run) {
        try {
          const devRoot = await resolveDevRoot(root);
          return ok({ dryRun: true, source, destination: path.join(devRoot, path.basename(source)), consoleCommand: `prl ${path.basename(source)}` });
        } catch (error) {
          return fail("DEV_ROOT", (error as Error).message);
        }
      }
      if (!confirm) return fail("CONFIRM_REQUIRED", "devplugins_sync overwrites the copy in dev_plugins; call again with confirm=true (or dry_run=true to preview)");
      try {
        const result = await syncPlugin(source, { override: root ?? options.devPluginsRoot });
        return ok(result);
      } catch (error) {
        return fail("SYNC", (error as Error).message);
      }
    },
  );

  server.registerTool(
    "package_zip",
    {
      title: "Package a plugin for mod.io",
      description: "Run preflight, then build the zip with plugin.json and main.lua at the archive root. Writes only inside the workspace. Upload is manual; the result includes the submission reminder.",
      inputSchema: {
        path: z.string().min(1).describe("Plugin folder, absolute or relative to the workspace"),
        outFile: z.string().optional().describe("Archive path; defaults to <workspace>/dist/<plugin>-<version>.zip"),
        overwrite: z.boolean().default(false),
        allowPlaceholderEmail: z.boolean().default(false).describe("Package even if contactEmailAddress is a placeholder (tests only)"),
      },
    },
    async ({ path: target, outFile, overwrite, allowPlaceholderEmail }) => {
      const denied = await checkReadable(target);
      if (denied) return fail("PATH_DENIED", denied);
      const source = path.resolve(workspaceRoot, target);
      const out = outFile ? path.resolve(workspaceRoot, outFile) : undefined;
      const writeDenied = await checkWritable(out ?? path.join(workspaceRoot, "dist", "x.zip"));
      if (writeDenied) return fail("PATH_DENIED", writeDenied);
      const pre = await preflightPlugin(source);
      const errors = pre.findings.filter((f) => f.level === "error");
      if (errors.length > 0) return fail("PREFLIGHT", `preflight found ${errors.length} error(s); fix them first: ${errors.map((f) => f.message).join("; ")}`);
      try {
        await fsp.mkdir(path.join(workspaceRoot, "dist"), { recursive: true });
        const result = await packagePlugin(source, { outFile: out, outDir: path.join(workspaceRoot, "dist"), overwrite, allowPlaceholderEmail });
        return ok(result);
      } catch (error) {
        return fail("PACKAGE", (error as Error).message);
      }
    },
  );

  return server;
}
