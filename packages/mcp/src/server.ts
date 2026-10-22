// @tmhs/rs3-plugin-mcp: MCP server for RuneScape 3 plugin development.
//
// Tools wrap the same core functions as the rs3dev CLI. Every tool that writes
// takes an explicit path and refuses anything outside the workspace root or
// the client's dev_plugins root. Documentation is fetched live and cached in
// the per-user cache folder; the server never indexes any plugin code other
// than the files inside the workspace it was started for.

import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildDocsIndex,
  DocsClient,
  type DocsPage,
  docsIndexPath,
  docsPageToText,
  type Finding,
  findDevPluginsRoot,
  isInside,
  loadDocsIndex,
  PERMISSIONS,
  type Permission,
  packagePlugin,
  pathExists,
  preflightPlugin,
  readUtf8,
  scaffoldPlugin,
  searchDocsIndex,
  stubsIndexPath,
  summarise,
  syncPlugin,
  validatePluginDir,
} from "@tmhs/rs3-devtools-core";
import { z } from "zod";
import { TOOL_ANNOTATIONS } from "./annotations.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";

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
  /** Where the full-text docs index lives; defaults to the per-user cache. */
  docsIndexPath?: string;
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
  /** Provenance written by the generator; absent in indexes from before it was recorded. */
  source?: { indexEtag?: string; indexLastModified?: string; pageCount?: number; generatorVersion?: string };
  modules: { id: string; title: string; url: string; file: string; etag?: string }[];
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
  // instructions reach every client in the initialise handshake, so an agent
  // without the Cursor rules or Claude skills still gets the policy.
  const server = new McpServer({ name: SERVER_NAME, version: options.version ?? "0.0.0" }, { instructions: SERVER_INSTRUCTIONS });
  // Every tool carries the annotations from annotations.ts so clients can tell
  // a read from a write before calling.
  const registerTool: McpServer["registerTool"] = (name: string, config: Record<string, unknown>, cb: unknown) =>
    server.registerTool(name, { ...config, annotations: TOOL_ANNOTATIONS[name] } as never, cb as never);
  const fullTextIndexFile = options.docsIndexPath ?? docsIndexPath();

  let indexCache: StubsIndex | undefined;
  let indexFile: string | undefined;
  const loadIndex = async (): Promise<StubsIndex> => {
    if (indexCache) return indexCache;
    indexFile = options.indexPath ?? (await stubsIndexPath());
    indexCache = JSON.parse(await readUtf8(indexFile)) as StubsIndex;
    return indexCache;
  };
  /** Folder that holds stubs/, index.json and unresolved.md. */
  const stubsDir = async (): Promise<string> => {
    await loadIndex();
    return path.dirname(indexFile!);
  };

  const resolveDevRoot = async (override?: string): Promise<string> => (await findDevPluginsRoot({ override: override ?? options.devPluginsRoot })).root;

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

  registerTool(
    "docs_search",
    {
      title: "Search the RuneScape Client API docs",
      description:
        "Search API symbols and documentation pages by name, and page sections by words once docs_index has built the per-user full-text index. Returns matching symbols with their signature and the exact docs URL.",
      inputSchema: {
        query: z.string().min(1).describe("Symbol or page name (PersistentDB, ui.Button, NPCEntityAdded) or plain words (combat level, chat message colour)"),
        limit: z.number().int().min(1).max(50).default(15),
      },
    },
    async ({ query, limit }) => {
      const index = await loadIndex();
      const fullText = await loadDocsIndex(fullTextIndexFile);
      const sections = fullText
        ? searchDocsIndex(fullText, query, Math.min(limit, 10)).map((h) => ({
            page: h.page,
            heading: h.heading,
            url: h.url,
            excerpt: h.excerpt,
            score: h.score,
          }))
        : undefined;
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
      return ok({
        query,
        stubsVersion: index.source?.generatorVersion ?? null,
        symbols,
        pages,
        sections,
        hint: sections
          ? "Use docs_get with a url (and the section anchor) to read the page text."
          : "Run docs_index once to search page sections by words; then use docs_get with a url to read the text.",
      });
    },
  );

  registerTool(
    "docs_index",
    {
      title: "Build the full-text docs index",
      description:
        "Fetch every documentation page through the ETag cache, convert it to text and build a per-user full-text index (never committed anywhere) so docs_search can answer questions in plain words. Takes a minute the first time; later runs only refetch changed pages.",
      inputSchema: {},
    },
    async () => {
      try {
        const { index, file } = await buildDocsIndex(docs, { outFile: fullTextIndexFile });
        return ok({ file, pages: index.pages, sections: index.documents.length, terms: Object.keys(index.terms).length, builtAt: index.builtAt });
      } catch (error) {
        return fail("DOCS_INDEX", (error as Error).message);
      }
    },
  );

  registerTool(
    "docs_get",
    {
      title: "Fetch a documentation page",
      description:
        "Fetch a developer.runescape.com page (live, with a local ETag cache) and return its text. Optionally restrict to one section by heading or anchor.",
      inputSchema: {
        url: z.string().min(1).describe("Full URL or path such as core/persistentdb.html"),
        section: z.string().optional().describe("Heading text or anchor id to return only that section"),
        maxChars: z.number().int().min(500).max(60000).default(16000),
      },
    },
    async ({ url, section, maxChars }) => {
      let page: DocsPage;
      try {
        page = await docs.getPage(url);
      } catch (error) {
        return fail("DOCS_FETCH", (error as Error).message);
      }
      const text = docsPageToText(page.html);
      let body = text.text;
      if (section) {
        // Anchors are unique per page, so they win; a heading may repeat
        // (several "Properties" sub-sections), in which case the agent gets the
        // anchors to choose from instead of an arbitrary slice.
        const explicitAnchor = section.trim().startsWith("#");
        const wanted = section.replace(/^#/, "").trim().toLowerCase();
        const indexed = text.sections.map((s, i) => ({ s, i }));
        const byAnchor = indexed.filter(({ s }) => s.anchor.toLowerCase() === wanted);
        const byHeading = indexed.filter(({ s }) => s.heading.toLowerCase() === wanted);
        // A bare word that names several headings is ambiguous even when it also
        // happens to equal the first one's anchor (mkdocs slugs headings); "#anchor"
        // is the explicit form.
        const matches = explicitAnchor ? byAnchor : byHeading.length > 1 ? byHeading : byAnchor.length > 0 ? byAnchor : byHeading;
        if (matches.length === 0) {
          return fail(
            "DOCS_SECTION",
            `no section "${section}" on ${page.url}; available anchors: ${text.sections.map((s) => s.anchor || `(line ${s.line + 1})`).join(", ")}`,
          );
        }
        if (matches.length > 1) {
          return fail(
            "DOCS_SECTION",
            `"${section}" matches ${matches.length} headings on ${page.url}; pass one of the anchors instead: ${matches.map(({ s }) => s.anchor || `(line ${s.line + 1})`).join(", ")}`,
          );
        }
        const { s: start, i: idx } = matches[0]!;
        const next = text.sections.slice(idx + 1).find((s) => s.level <= start.level);
        body =
          body
            .split("\n")
            .slice(start.line, next ? next.line : undefined)
            .join("\n")
            .trim() + "\n";
      }
      const truncated = body.length > maxChars;
      if (truncated) body = body.slice(0, maxChars) + `\n\n[truncated; ${body.length} characters total. Pass a section or a larger maxChars.]`;
      return ok({
        url: page.url,
        title: text.title,
        source: page.source,
        sections: text.sections.map((s) => s.anchor),
        text: body,
        copyright: "Documentation content is copyright Jagex; link to it rather than copying it into plugins or repositories.",
      });
    },
  );

  registerTool(
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
      return ok({
        query: name,
        stubsVersion: index.source?.generatorVersion ?? null,
        matches: matches.map((s) => ({ name: s.name, kind: s.kind, signature: s.signature, stubFile: s.file, url: s.url })),
      });
    },
  );

  registerTool(
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

  registerTool(
    "guidelines_preflight",
    {
      title: "Preflight a plugin against the submission guidelines",
      description:
        "Static checks for sandbox-forbidden globals, permission use without declaration, URLs outside the manifest, missing contact email, lifecycle leaks (missing PluginShutdown, Subscribe without Unsubscribe, undestroyed containers, per-tick list scans) and minified or obfuscated code. Honours rs3dev.json in the plugin folder and inline rs3dev-ignore comments. Each finding links the relevant docs page.",
      inputSchema: {
        path: z.string().min(1).describe("Plugin folder, absolute or relative to the workspace"),
        ignore: z.array(z.string()).default([]).describe("Finding codes to drop, in addition to rs3dev.json preflight.ignore"),
      },
    },
    async ({ path: target, ignore }) => {
      const denied = await checkReadable(target);
      if (denied) return fail("PATH_DENIED", denied);
      const result = await preflightPlugin(path.resolve(workspaceRoot, target), { ignore });
      return ok({
        ...findingsPayload("guidelines_preflight", result.findings),
        suppressed: result.suppressed,
        configFile: result.configFile,
        filesChecked: result.files,
      });
    },
  );

  registerTool(
    "plugin_scaffold",
    {
      title: "Scaffold a new plugin",
      description:
        "Create a new plugin folder with a commented main.lua, plugin.json, .luarc.json and agent guidance files. Writes only inside the workspace and never overwrites existing files.",
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

  registerTool(
    "devplugins_sync",
    {
      title: "Copy a plugin into dev_plugins",
      description:
        "Copy the plugin folder into the client's dev_plugins root (overwriting the previous copy) and return the console reload command. Requires confirm=true; dry_run returns the destination and the exact files a real sync would copy and remove, without writing.",
      inputSchema: {
        path: z.string().min(1).describe("Plugin folder, absolute or relative to the workspace"),
        root: z.string().optional().describe("dev_plugins folder; defaults to RS3_DEV_PLUGINS_DIR or client detection"),
        confirm: z.boolean().default(false).describe("Must be true to perform the copy"),
        dry_run: z.boolean().default(false).describe("Report the destination and the files that would be copied and removed, without copying"),
      },
    },
    async ({ path: target, root, confirm, dry_run }) => {
      const denied = await checkReadable(target);
      if (denied) return fail("PATH_DENIED", denied);
      const source = path.resolve(workspaceRoot, target);
      if (dry_run) {
        try {
          return ok(await syncPlugin(source, { override: root ?? options.devPluginsRoot, dryRun: true }));
        } catch (error) {
          return fail("DEV_ROOT", (error as Error).message);
        }
      }
      if (!confirm)
        return fail("CONFIRM_REQUIRED", "devplugins_sync overwrites the copy in dev_plugins; call again with confirm=true (or dry_run=true to preview)");
      try {
        const result = await syncPlugin(source, { override: root ?? options.devPluginsRoot });
        return ok(result);
      } catch (error) {
        return fail("SYNC", (error as Error).message);
      }
    },
  );

  registerTool(
    "package_zip",
    {
      title: "Package a plugin for mod.io",
      description:
        "Run preflight, then build the zip with plugin.json and main.lua at the archive root. Writes only inside the workspace. Upload is manual; the result includes the submission reminder.",
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

  // Prompts mirror the Claude Code skills so a client without them can still
  // pick the workflow.
  const prompt = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

  server.registerPrompt(
    "new_plugin",
    {
      title: "Start a new plugin",
      description: "Scaffold a plugin folder, gate its permissions, and leave it validated and preflighted.",
      argsSchema: {
        name: z.string().describe("Folder name; lowercase words joined with hyphens, used by pon, poff and prl"),
        permissions: z.string().optional().describe("Optional permissions, comma separated: httpAccess, chatAccess, trackingAccess"),
      },
    },
    ({ name, permissions }) =>
      prompt(
        [
          `Create a RuneScape 3 plugin named "${name}" in this workspace.`,
          `1. Call plugin_scaffold with path "${name}"${
            permissions
              ? ` and permissions [${permissions
                  .split(",")
                  .map((p) => `"${p.trim()}"`)
                  .join(", ")}]`
              : " and no permissions"
          }. Never overwrite an existing folder.`,
          "2. Read the generated main.lua and keep its structure: reference names at the top, helpers, UI construction, event subscriptions, then PluginShutdown that unsubscribes every event and destroys every component.",
          "3. Gate every optional permission with Plugin.HasPermission so the plugin still works when the user declines; request only URLs declared under urls in plugin.json through Plugin.urls.<name>.",
          "4. Set contactEmailAddress in plugin.json to the address users should write to; package_zip refuses placeholders.",
          "5. Call manifest_validate and guidelines_preflight and fix every finding using its docs link until both report zero errors.",
          "6. Tell the developer to run devplugins_sync with confirm=true, then prf and pon in the client console (ALT+backtick), and prl after each change.",
          "Use docs_search and api_lookup instead of guessing an API, link documentation instead of pasting it, and never read other developers' plugins.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "fix_preflight",
    {
      title: "Fix preflight findings",
      description: "Run guidelines_preflight on a plugin and fix every finding one by one using its documentation link.",
      argsSchema: { path: z.string().describe("Plugin folder, absolute or relative to the workspace") },
    },
    ({ path: target }) =>
      prompt(
        [
          `Run guidelines_preflight on "${target}".`,
          "For each finding, in order errors then warnings then notes: open its docsUrl with docs_get (pass the anchor as section), read the rule, change the plugin so the rule holds, and say in one line what changed and why.",
          "Errors are rejection reasons (sandbox globals including through _G, permissions without declaration, URLs outside the manifest passed to HTTPRequest, missing PluginShutdown, placeholder contact address). Warnings are moderator complaints (unreleased subscriptions, per-tick list scans, long lines, low comment ratio, encoded strings). Do not suppress a finding unless the developer has reviewed it; a reviewed exception goes in rs3dev.json under preflight.ignore or as a rs3dev-ignore comment on the line above.",
          "Re-run guidelines_preflight until it reports zero errors, then run manifest_validate.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "prepare_submission",
    {
      title: "Prepare the mod.io submission",
      description: "Walk the submission checklist and build the zip for the manual mod.io upload.",
      argsSchema: { path: z.string().describe("Plugin folder, absolute or relative to the workspace") },
    },
    ({ path: target }) =>
      prompt(
        [
          `Prepare "${target}" for submission.`,
          "1. manifest_validate and guidelines_preflight must both report zero errors; fix findings first (see the fix_preflight prompt).",
          "2. Check plugin.json: a real contactEmailAddress, a version bumped since the last submission, only the permissions the plugin needs, only the urls it fetches.",
          "3. Ask the developer to confirm a clean reload in the client: devplugins_sync with confirm=true, prl <name>, exercise every feature, and poff <name> leaves no window behind.",
          "4. Call package_zip. Report the archive path and size and that plugin.json and main.lua sit at the archive root.",
          "5. Remind the developer that upload is manual on mod.io with Jagex moderation, with the description per https://developer.runescape.com/rs/submission/example.html and the legal requirements on https://developer.runescape.com/rs/submission/index.html.",
        ].join("\n"),
      ),
  );

  // Resources: the stubs index, the unresolved report and each stub file, for
  // clients that browse resources instead of calling tools.
  server.registerResource(
    "stubs-index",
    "rs3://stubs/index.json",
    { title: "Stubs symbol index", description: "index.json served by api_lookup and docs_search", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: await readUtf8(path.join(await stubsDir(), "index.json")) }] }),
  );
  server.registerResource(
    "stubs-unresolved",
    "rs3://stubs/unresolved.md",
    {
      title: "Unresolved and inferred API surface",
      description: "The generator's report of names it could not resolve from the docs",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const file = path.join(await stubsDir(), "unresolved.md");
      const text = (await pathExists(file)) ? await readUtf8(file) : "unresolved.md is not present beside this index.json\n";
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );
  server.registerResource(
    "stubs-module",
    // {+id} (reserved expansion) so ids with slashes such as core/persistentdb match.
    new ResourceTemplate("rs3://stubs/modules/{+id}", {
      list: async () => {
        const index = await loadIndex();
        return {
          resources: index.modules.map((m) => ({ uri: `rs3://stubs/modules/${m.id}`, name: m.id, title: m.title, description: m.url, mimeType: "text/x-lua" })),
        };
      },
    }),
    {
      title: "Stub module",
      description: "The LuaLS ---@meta stub for one documentation page; id is the page path without extension, for example core/persistentdb",
      mimeType: "text/x-lua",
    },
    async (uri, { id }) => {
      const index = await loadIndex();
      const moduleId = Array.isArray(id) ? id.join("/") : String(id);
      const mod = index.modules.find((m) => m.id === moduleId);
      if (!mod) throw new Error(`no stub module "${moduleId}"; list rs3://stubs/modules/ for the ids`);
      return { contents: [{ uri: uri.href, mimeType: "text/x-lua", text: await readUtf8(path.join(await stubsDir(), ...mod.file.split("/"))) }] };
    },
  );

  return server;
}
