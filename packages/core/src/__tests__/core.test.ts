import { promises as fsp } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { adoptPlugin, writePluginLuarc } from "../adopt.js";
import { DocsClient, DocsFetchError, normaliseDocsPath } from "../docs-client.js";
import { docsPageToText, extractNavLinks } from "../docs-text.js";
import { formatDoctorReport, runDoctor } from "../doctor.js";
import { formatFindingsGithub, toSarif } from "../findings.js";
import { isInside, pathExists, readUtf8 } from "../fs.js";
import { isJunk, parseIgnoreFile } from "../ignore.js";
import { enclosingCall, globalReads, indirectGlobalReads, memberChains, requireCalls, scanLua } from "../lua-scan.js";
import { libraryPathFor, resolveStubsDir } from "../luarc.js";
import { isDevArtifact, isPlaceholderEmail, validateManifestObject, validatePluginDir } from "../manifest.js";
import { packagePlugin } from "../package.js";
import { defaultClientRoots, findDevPluginsRoot } from "../paths.js";
import { preflightPlugin } from "../preflight.js";
import { SCAFFOLD_TEMPLATES, scaffoldPlugin } from "../scaffold.js";
import { checkStubsStatus } from "../stubs-status.js";
import { syncPlugin } from "../sync.js";
import { verifyArchive } from "../verify.js";
import { watchPlugin } from "../watch.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const plugin = (name: string) => path.join(fixtures, "plugins", name);
const manifestFixture = async (name: string) => JSON.parse(await readUtf8(path.join(fixtures, "manifests", name)));

const tempDirs: string[] = [];
async function tempDir(prefix: string): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await fsp.rm(dir, { recursive: true, force: true });
});

const codes = (findings: { code: string }[]) => findings.map((f) => f.code);

describe("manifest validation", () => {
  it("accepts a complete manifest", async () => {
    expect(validateManifestObject(await manifestFixture("good.json"))).toEqual([]);
  });
  it("reports a missing contactEmailAddress", async () => {
    const findings = validateManifestObject(await manifestFixture("bad-missing-email.json"));
    expect(findings.some((f) => f.message.includes("contactEmailAddress"))).toBe(true);
    expect(findings[0]!.docsUrl).toContain("structure.html#manifest");
  });
  it("rejects unknown permissions, bad urls, wrong dependency shapes and unknown fields", async () => {
    expect(validateManifestObject(await manifestFixture("bad-permission.json")).length).toBeGreaterThan(0);
    const url = validateManifestObject(await manifestFixture("bad-url.json"));
    expect(url.some((f) => f.message.includes("urls"))).toBe(true);
    const deps = validateManifestObject(await manifestFixture("bad-deps.json"));
    expect(deps.some((f) => f.message.includes("requiredDependencies"))).toBe(true);
    expect(deps.some((f) => f.message.includes("unknownField"))).toBe(true);
  });
  it("validates the plugin folder structure", async () => {
    const clean = await validatePluginDir(plugin("clean"));
    expect(clean.findings.filter((f) => f.level === "error")).toEqual([]);
    const missing = await validatePluginDir(plugin("missing-main"));
    expect(codes(missing.findings)).toContain("main-missing");
  });
  it("checks require targets from tokens and only accepts the documented slash form", async () => {
    const { findings } = await validatePluginDir(plugin("require-forms"));
    const requires = findings.filter((f) => f.code.startsWith("require-"));
    expect(requires.map((f) => [f.code, f.line])).toEqual([
      ["require-dotted", 7],
      ["require-missing", 8],
      ["require-path", 9],
    ]);
    expect(requires[0]!.message).toContain('use require("lib/helpers")');
    expect(requires[1]!.message).toContain("lib/init.lua is not loaded by the client");
    // Nothing from the comment or the string literal.
    expect(findings.some((f) => f.message.includes("ghost"))).toBe(false);
  });
  it("treats dotfiles and dev files as artefacts", () => {
    expect(isDevArtifact(".luarc.json")).toBe(true);
    expect(isDevArtifact(".cursor/rules/x.mdc")).toBe(true);
    expect(isDevArtifact("AGENTS.md")).toBe(true);
    expect(isDevArtifact("resources/icon.png")).toBe(false);
    expect(isDevArtifact("main.lua")).toBe(false);
  });
});

describe("lua scanner", () => {
  it("separates comments and strings from code", () => {
    const scan = scanLua('-- os.exit in a comment\nlocal s = "io.open in a string"\nlocal x = os.clock() --[[ long\ncomment ]]');
    const names = globalReads(scan).map((r) => r.name);
    expect(names).toContain("os");
    expect(names).not.toContain("io");
    expect(names).not.toContain("s");
    expect(scan.strings.map((s) => s.value)).toEqual(["io.open in a string"]);
    expect(scan.commentLines).toBe(3);
  });
  it("treats table constructor keys as strings and _G access as a read", () => {
    const scan = scanLua(
      [
        'local s = { debug = false, io = "x"; load = { os = 1 } }',
        "local f = g(a, b)",
        "goto debug",
        "::debug::",
        'local x = _G.os + _G["io"] + rawget(_G, "debug")',
      ].join("\n"),
    );
    expect(globalReads(scan).map((r) => r.name)).toEqual(["g", "a", "b", "_G", "_G", "rawget", "_G"]);
    expect(indirectGlobalReads(scan)).toEqual([
      { name: "os", line: 5 },
      { name: "io", line: 5 },
      { name: "debug", line: 5 },
    ]);
  });
  it("finds require calls from tokens only", () => {
    const lines = ['-- require("a")', "local s = \"require('b')\"", 'local m = require("c/d")', 'local n = require "e"', 'local o = obj.require("f")'];
    const scan = scanLua(lines.join("\n"));
    expect(requireCalls(scan)).toEqual([
      { target: "c/d", line: 3 },
      { target: "e", line: 4 },
    ]);
  });
  it("collects member chains and marks the ones rooted at a local", () => {
    const chains = memberChains(scanLua("local obj = {}\nEvent.ChatMessage.Subscribe('a', f)\nlocal r = HTTPRequest.new(u)\nobj:Method()"));
    expect(chains.map((c) => c.chain)).toEqual(["Event.ChatMessage.Subscribe", "HTTPRequest.new", "obj:Method"]);
    expect(chains.map((c) => c.rootDeclared)).toEqual([false, false, true]);
  });
  it("finds the call that encloses a token", () => {
    const scan = scanLua(
      'local r = HTTPRequest.new("https://a.test/", path)\nlog("https://b.test/")\nlocal t = { url = "https://c.test/" }\nx = f(g("https://d.test/"))',
    );
    const tokens = scan.tokens.filter((t) => t.kind !== "comment");
    const urls = tokens.map((t, i) => ({ t, i })).filter(({ t }) => t.kind === "string");
    expect(urls.map(({ i }) => enclosingCall(tokens, i))).toEqual(["HTTPRequest.new", "log", undefined, "g"]);
  });
});

describe("preflight", () => {
  it("passes a clean plugin", async () => {
    const result = await preflightPlugin(plugin("clean"));
    expect(result.findings.filter((f) => f.level === "error")).toEqual([]);
  });
  it("flags sandbox-forbidden globals once per use, ignoring comments and strings", async () => {
    const result = await preflightPlugin(plugin("sandbox"));
    const sandbox = result.findings.filter((f) => f.code === "sandbox-global");
    expect(sandbox.map((f) => f.message)).toEqual([
      expect.stringContaining('"os"'),
      expect.stringContaining('"io"'),
      expect.stringContaining('"load"'),
      expect.stringContaining('"debug"'),
      expect.stringContaining('"os" is not available to plugins and will be rejected (reached through _G)'),
      expect.stringContaining('"io" is not available to plugins and will be rejected (reached through _G)'),
      expect.stringContaining('"debug" is not available to plugins and will be rejected (reached through _G)'),
    ]);
    expect(sandbox[0]!.line).toBe(4);
    expect(sandbox[0]!.docsUrl).toContain("guidelines");
    // _G.os, _G["io"] and rawget(_G, "debug") sit on consecutive lines.
    expect(sandbox.slice(4).map((f) => f.line)).toEqual([10, 11, 12]);
  });
  it("does not report table constructor keys, parameters, field definitions or labels as sandbox reads", async () => {
    const result = await preflightPlugin(plugin("table-keys"));
    expect(result.findings).toEqual([]);
  });
  it("reports only manifest-missing and main-missing for an empty folder", async () => {
    const dir = await tempDir("rs3-empty-");
    const result = await preflightPlugin(dir);
    expect(codes(result.findings).sort()).toEqual(["main-missing", "manifest-missing"]);
  });
  it("flags chat and tracking use without the permission", async () => {
    const result = await preflightPlugin(plugin("chat-no-permission"));
    expect(codes(result.findings)).toContain("chat-permission");
    expect(codes(result.findings)).toContain("tracking-permission");
  });
  it("flags URL literals passed to HTTPRequest outside the manifest urls", async () => {
    const result = await preflightPlugin(plugin("http-outside-urls"));
    const outside = result.findings.filter((f) => f.code === "url-outside-manifest");
    expect(outside).toHaveLength(1);
    expect(outside[0]!.level).toBe("error");
    expect(outside[0]!.message).toContain("example.org");
    expect(outside[0]!.message).toContain("HTTPRequest.new");
    expect(codes(result.findings)).not.toContain("http-permission");
  });
  it("only warns about URL literals that are never requested", async () => {
    const result = await preflightPlugin(plugin("url-display-only"));
    expect(result.findings.filter((f) => f.level === "error")).toEqual([]);
    const outside = result.findings.filter((f) => f.code === "url-outside-manifest");
    expect(outside).toHaveLength(1);
    expect(outside[0]!.level).toBe("warning");
    expect(outside[0]!.message).toContain("display text");
  });
  it("ignores permission chains rooted at a local of the file", async () => {
    const result = await preflightPlugin(plugin("local-chat-module"));
    expect(result.findings.filter((f) => f.level === "error")).toEqual([]);
    expect(codes(result.findings)).not.toContain("chat-permission");
    expect(codes(result.findings)).not.toContain("http-permission");
  });
  it("warns about minified or obfuscated-looking code", async () => {
    const result = await preflightPlugin(plugin("minified"));
    const c = codes(result.findings);
    expect(c).toContain("long-lines");
    expect(c).toContain("low-comment-ratio");
    expect(c).toContain("encoded-string");
    expect(c).toContain("string-char-chain");
  });
  it("reports lifecycle leaks: missing PluginShutdown, unreleased subscriptions, undestroyed containers, per-tick scans", async () => {
    const missing = await preflightPlugin(plugin("lifecycle-missing-shutdown"));
    const shutdown = missing.findings.filter((f) => f.code === "shutdown-missing");
    expect(shutdown).toHaveLength(1);
    expect(shutdown[0]!.level).toBe("error");
    expect(shutdown[0]!.line).toBe(7);

    const leaks = await preflightPlugin(plugin("lifecycle-leaks"));
    expect(codes(leaks.findings)).not.toContain("shutdown-missing");
    const unreleased = leaks.findings.filter((f) => f.code === "subscribe-without-unsubscribe");
    expect(unreleased.map((f) => f.line).sort((a, b) => a! - b!)).toEqual([28, 36, 38]);
    expect(unreleased.find((f) => f.line === 38)!.message).toContain("button:Unsubscribe");
    const containers = leaks.findings.filter((f) => f.code === "component-not-destroyed");
    expect(containers.map((f) => f.message)).toEqual([expect.stringContaining('"overlay"')]);
    const scans = leaks.findings.filter((f) => f.code === "per-tick-scan");
    expect(scans).toHaveLength(1);
    expect(scans[0]!.line).toBe(22);
    expect(scans[0]!.message).toContain("NPCList.All");

    // Correct plugins pay nothing.
    for (const name of ["clean", "table-keys"]) {
      const result = await preflightPlugin(plugin(name));
      expect(
        codes(result.findings).filter((c) => ["shutdown-missing", "subscribe-without-unsubscribe", "component-not-destroyed", "per-tick-scan"].includes(c)),
      ).toEqual([]);
    }
  });
  it("honours rs3dev.json, --ignore and inline rs3dev-ignore comments", async () => {
    const dir = plugin("config-ignore");
    const result = await preflightPlugin(dir);
    expect(result.configFile).toBe(path.join(dir, "rs3dev.json"));
    // maxLineLength 60 from the file turns the long table line into a warning.
    expect(codes(result.findings)).toContain("long-lines");
    // Both os.* reads are suppressed inline (comment above, comment on the same line).
    expect(codes(result.findings)).not.toContain("sandbox-global");
    expect(result.suppressed.filter((f) => f.code === "sandbox-global").map((f) => f.line)).toEqual([6, 8]);
    // A flag adds to the file's ignore list.
    const ignored = await preflightPlugin(dir, { ignore: ["long-lines"] });
    expect(codes(ignored.findings)).not.toContain("long-lines");
    expect(codes(ignored.suppressed)).toContain("long-lines");
    // Without the file the defaults apply and the inline markers still work.
    const noConfig = await preflightPlugin(dir, { config: false });
    expect(codes(noConfig.findings)).not.toContain("long-lines");
    expect(noConfig.configFile).toBeUndefined();
    // An invalid file is reported, never silently ignored.
    const broken = await tempDir("rs3-config-broken-");
    await fsp.cp(dir, broken, { recursive: true });
    await fsp.writeFile(path.join(broken, "rs3dev.json"), JSON.stringify({ preflight: { ignore: "nope" } }));
    const invalid = await preflightPlugin(broken);
    expect(codes(invalid.findings)).toContain("config-schema");
    expect(isDevArtifact("rs3dev.json")).toBe(true);
    expect(isDevArtifact("lib/rs3dev.json")).toBe(false);
  });
  it("renders GitHub workflow commands and SARIF", () => {
    const findings = [
      {
        level: "error" as const,
        code: "sandbox-global",
        message: 'os is not available: see "docs", 100% sure',
        file: "main.lua",
        line: 3,
        docsUrl: "https://example.test/rules",
      },
      { level: "info" as const, code: "optional-permission-ungated", message: "gate it", file: "plugin.json", docsUrl: "https://example.test/perm" },
    ];
    const gh = formatFindingsGithub(findings, "plugins/demo");
    expect(gh[0]).toBe(
      '::error file=plugins/demo/main.lua,line=3,title=sandbox-global::os is not available: see "docs", 100%25 sure (see https://example.test/rules)',
    );
    expect(gh[1]).toBe("::notice file=plugins/demo/plugin.json,title=optional-permission-ungated::gate it (see https://example.test/perm)");
    const sarif = toSarif(findings, { name: "rs3dev", version: "1.2.3", command: "preflight" }) as {
      runs: { tool: { driver: { rules: { id: string }[] } }; results: { ruleId: string; level: string; locations?: unknown[] }[] }[];
    };
    expect(sarif.runs[0]!.tool.driver.rules.map((r) => r.id)).toEqual(["sandbox-global", "optional-permission-ungated"]);
    expect(sarif.runs[0]!.results.map((r) => r.level)).toEqual(["error", "note"]);
    expect(sarif.runs[0]!.results[0]!.locations).toHaveLength(1);
  });
  it("reports a missing main.lua as an error", async () => {
    const result = await preflightPlugin(plugin("missing-main"));
    expect(codes(result.findings)).toContain("main-missing");
  });
});

describe("sync", () => {
  it("copies into dev_plugins, excludes dev artefacts, prunes stale files and prints the reload command", async () => {
    const root = path.join(await tempDir("rs3-devplugins-"), "dev_plugins");
    await fsp.mkdir(root);
    // A previous copy of the plugin with a file the source no longer has.
    const stale = path.join(root, "clean", "old.lua");
    await fsp.mkdir(path.dirname(stale), { recursive: true });
    await fsp.writeFile(stale, "-- stale");
    await fsp.copyFile(path.join(plugin("clean"), "plugin.json"), path.join(root, "clean", "plugin.json"));
    const result = await syncPlugin(plugin("clean"), { override: root });
    expect(result.consoleCommand).toBe("prl clean");
    expect(result.copied).toEqual(["lib/helpers.lua", "main.lua", "plugin.json"]);
    expect(result.removed).toEqual(["old.lua"]);
    expect(await readUtf8(path.join(root, "clean", "main.lua"))).toContain("Clean fixture");
  });
  it("honours RS3_DEV_PLUGINS_DIR and detects a client root by *.jcache files", async () => {
    const env = path.join(await tempDir("rs3-env-"), "dev_plugins");
    await fsp.mkdir(env);
    expect((await findDevPluginsRoot({ env: { RS3_DEV_PLUGINS_DIR: env } })).source).toBe("env");
    const client = await tempDir("rs3-client-");
    await fsp.writeFile(path.join(client, "main.jcache"), "");
    const detected = await findDevPluginsRoot({ env: {}, candidateClientRoots: [client] });
    expect(detected.source).toBe("detected");
    expect(detected.root).toBe(path.join(client, "dev_plugins"));
    await expect(findDevPluginsRoot({ env: {}, candidateClientRoots: [env] })).rejects.toThrow(/jcache/);
    // A folder beside the jcache files passes even when it is not named dev_plugins.
    const beside = path.join(client, "plugins_dev");
    await fsp.mkdir(beside);
    expect((await findDevPluginsRoot({ override: beside })).root).toBe(beside);
  });
  it("knows the default client folders for every platform", () => {
    const home = path.join("/", "home", "ada");
    expect(defaultClientRoots({ ProgramData: "D:\\PD" }, "win32", home)).toEqual([path.join("D:\\PD", "Jagex", "RuneScape-BETA")]);
    expect(defaultClientRoots({}, "darwin", home)).toEqual([path.join(home, "Jagex", "RuneScape-BETA")]);
    const linux = defaultClientRoots({ USER: "ada" }, "linux", home);
    expect(linux[0]).toBe(path.join(home, ".local", "share", "bolt-launcher", "jagex", "RuneScape-BETA"));
    expect(linux[1]).toContain(path.join("com.jagex.Launcher", "data", "wine", "drive_c", "users"));
    expect(linux[1]).toContain("RuneScape-BETA");
  });
  it("rejects an explicit root that does not exist or does not look like dev_plugins", async () => {
    const base = await tempDir("rs3-badroot-");
    const typo = path.join(base, "dev_plugnis");
    await expect(findDevPluginsRoot({ override: typo })).rejects.toThrow(/does not exist \(resolved to .*dev_plugnis\)/);
    // A Windows path copied into a Unix config resolves under the cwd and does not exist either.
    await expect(
      findDevPluginsRoot({ env: { RS3_DEV_PLUGINS_DIR: "C:\\ProgramData\\Jagex\\RuneScape-BETA\\dev_plugins" }, override: undefined }),
    ).rejects.toThrow(/RS3_DEV_PLUGINS_DIR .* does not exist|does not look like a dev_plugins folder/);
    const documents = path.join(base, "Documents");
    await fsp.mkdir(documents);
    await expect(findDevPluginsRoot({ override: documents })).rejects.toThrow(/does not look like a dev_plugins folder/);
    await expect(syncPlugin(plugin("clean"), { override: documents })).rejects.toThrow(/does not look like a dev_plugins folder/);
    // --create-root is the escape hatch and creates the folder.
    const created = await findDevPluginsRoot({ override: typo, createRoot: true });
    expect(created.root).toBe(typo);
    expect(await fsp.stat(typo).then((s) => s.isDirectory())).toBe(true);
  });
  it("refuses to prune a non-empty destination that is not a plugin copy", async () => {
    const root = path.join(await tempDir("rs3-prune-"), "dev_plugins");
    await fsp.mkdir(path.join(root, "clean", "notes"), { recursive: true });
    await fsp.writeFile(path.join(root, "clean", "notes", "thesis.txt"), "keep me");
    await expect(syncPlugin(plugin("clean"), { override: root })).rejects.toThrow(/holds no plugin\.json/);
    expect(await readUtf8(path.join(root, "clean", "notes", "thesis.txt"))).toBe("keep me");
    // An empty destination is fine, and so is one that already holds a plugin.json.
    await fsp.rm(path.join(root, "clean"), { recursive: true, force: true });
    await fsp.mkdir(path.join(root, "clean"));
    expect((await syncPlugin(plugin("clean"), { override: root })).copied).toContain("main.lua");
    await fsp.writeFile(path.join(root, "clean", "old.lua"), "-- stale");
    expect((await syncPlugin(plugin("clean"), { override: root })).removed).toEqual(["old.lua"]);
  });
  it("watch runs syncs strictly one after another, starting with the initial copy", async () => {
    const base = await tempDir("rs3-watch-");
    const src = path.join(base, "watched");
    await fsp.cp(plugin("clean"), src, { recursive: true });
    const root = path.join(base, "dev_plugins");
    await fsp.mkdir(root);
    let active = 0;
    let overlap = 0;
    let syncs = 0;
    const watcher = watchPlugin(src, {
      override: root,
      debounceMs: 20,
      onSync: () => {
        syncs++;
      },
      onError: (error) => {
        throw error;
      },
    });
    // Instrument overlap by wrapping the destination writes: two syncs at once would
    // both be "active" when the second one starts.
    const original = fsp.copyFile;
    (fsp as { copyFile: typeof fsp.copyFile }).copyFile = async (...args: Parameters<typeof fsp.copyFile>) => {
      active++;
      if (active > 1) overlap++;
      try {
        await new Promise((r) => setTimeout(r, 5));
        return await original(...args);
      } finally {
        active--;
      }
    };
    try {
      // Save during the initial copy, then a burst of saves.
      await fsp.writeFile(path.join(src, "extra1.lua"), "-- 1");
      await watcher.ready;
      for (let i = 2; i <= 5; i++) await fsp.writeFile(path.join(src, `extra${i}.lua`), `-- ${i}`);
      await new Promise((r) => setTimeout(r, 400));
    } finally {
      await watcher.close();
      (fsp as { copyFile: typeof fsp.copyFile }).copyFile = original;
    }
    expect(overlap).toBe(0);
    expect(syncs).toBeGreaterThanOrEqual(2);
    expect(await readUtf8(path.join(root, "watched", "extra5.lua"))).toBe("-- 5");
  });
});

describe("adopt and luarc", () => {
  it("adopts an existing plugin, refreshes a stale .luarc.json and vendors the stubs", async () => {
    const base = await tempDir("rs3-adopt-");
    const stubs = path.join(base, "stubs");
    await fsp.mkdir(stubs);
    await fsp.writeFile(path.join(stubs, "_globals.lua"), "---@meta\n");
    await fsp.writeFile(path.join(stubs, "core.lua"), "---@meta\n");
    const dir = path.join(base, "existing");
    await fsp.cp(plugin("clean"), dir, { recursive: true });
    const manifestBefore = await readUtf8(path.join(dir, "plugin.json"));
    // A .luarc.json pointing at a folder that moved away, with a global the author added.
    await fsp.writeFile(path.join(dir, ".luarc.json"), JSON.stringify({ "workspace.library": ["../gone/stubs"], "diagnostics.globals": ["PrettyUI"] }));
    const stale = await validatePluginDir(dir);
    const warning = stale.findings.find((f) => f.code === "luarc-stale");
    expect(warning?.level).toBe("warning");
    expect(warning?.message).toContain("rs3dev luarc");
    await expect(adoptPlugin(path.join(base, "not-a-plugin"), { stubsDir: stubs })).rejects.toThrow(/no plugin\.json/);

    const adopted = await adoptPlugin(dir, { stubsDir: stubs, agentFiles: true });
    expect(adopted.luarc.source).toBe("--stubs");
    expect(adopted.luarc.library).toBe("../stubs");
    const luarc = JSON.parse(await readUtf8(path.join(dir, ".luarc.json")));
    expect(luarc["diagnostics.globals"]).toEqual(["PrettyUI"]);
    expect(adopted.files).toContain("AGENTS.md");
    expect(await readUtf8(path.join(dir, "plugin.json"))).toBe(manifestBefore);
    expect((await validatePluginDir(dir)).findings.some((f) => f.code === "luarc-stale")).toBe(false);
    // Adopting again keeps the existing agent files.
    expect((await adoptPlugin(dir, { stubsDir: stubs })).files).toEqual([]);

    const vendored = await writePluginLuarc(dir, { stubsDir: stubs, vendor: true });
    expect(vendored.source).toBe("vendored");
    expect(vendored.library).toBe("./.rs3/stubs");
    expect(vendored.vendoredFiles).toBe(2);
    expect(await pathExists(path.join(dir, ".rs3", "stubs", "_globals.lua"))).toBe(true);
    expect(JSON.parse(await readUtf8(path.join(dir, ".luarc.json")))["workspace.library"]).toEqual(["./.rs3/stubs"]);
    // The vendored copy is a dotfolder, so it never ships.
    expect(isDevArtifact(".rs3/stubs/_globals.lua")).toBe(true);
    expect((await validatePluginDir(dir)).findings.some((f) => f.code === "luarc-stale")).toBe(false);
  });
});

describe("stubs status", () => {
  it("reports current on 304, changed on a new ETag, unknown without provenance and offline on errors", async () => {
    const dir = await tempDir("rs3-stubs-status-");
    const indexPath = path.join(dir, "index.json");
    const write = (source?: Record<string, unknown>) =>
      fsp.writeFile(indexPath, JSON.stringify({ baseUrl: "https://example.test/rs/", source, modules: [{}, {}], symbols: [] }));
    await write({ indexEtag: '"v1"', generatorVersion: "1.2.3", pageCount: 2 });
    const calls: string[] = [];
    const respond = (status: number, etag?: string) =>
      (async (_url: string | URL | Request, init?: RequestInit) => {
        calls.push(String(new Headers(init?.headers).get("if-none-match")));
        return new Response(status === 304 ? null : "<html></html>", { status, headers: etag ? { etag } : {} });
      }) as typeof fetch;
    const current = await checkStubsStatus({ indexPath, fetchImpl: respond(304) });
    expect(current.status).toBe("current");
    expect(current.stubsVersion).toBe("1.2.3");
    expect(current.modules).toBe(2);
    expect(calls[0]).toBe('"v1"');
    const changed = await checkStubsStatus({ indexPath, fetchImpl: respond(200, '"v2"') });
    expect(changed.status).toBe("changed");
    expect(changed.currentEtag).toBe('"v2"');
    expect(changed.message).toContain("stubs:generate");
    const same = await checkStubsStatus({ indexPath, fetchImpl: respond(200, '"v1"') });
    expect(same.status).toBe("current");
    const offline = await checkStubsStatus({
      indexPath,
      fetchImpl: (async () => {
        throw new Error("ENOTFOUND");
      }) as typeof fetch,
    });
    expect(offline.status).toBe("offline");
    await write(undefined);
    const unknown = await checkStubsStatus({ indexPath, fetchImpl: respond(304) });
    expect(unknown.status).toBe("unknown");
  });
});

describe("doctor", () => {
  it("reports what is missing on a machine without the client or LuaLS, with hints", async () => {
    const base = await tempDir("rs3-doctor-");
    const stubs = path.join(base, "stubs");
    await fsp.mkdir(stubs);
    const env = { RS3_DEVTOOLS_CACHE_DIR: path.join(base, "cache"), RS3_STUBS_DIR: stubs };
    const report = await runDoctor({ env, luaLanguageServer: path.join(base, "no-such-luals"), pluginDir: path.join(base, "no-plugin") });
    const byItem = Object.fromEntries(report.rows.map((r) => [r.item, r]));
    expect(Object.keys(byItem)).toEqual(["node", "dev_plugins", "stubs", "luals", "luarc", "cache"]);
    expect(byItem.node!.status).toBe("ok");
    expect(byItem.dev_plugins!.status).toBe("missing");
    expect(byItem.dev_plugins!.hint).toContain("jcache");
    expect(byItem.stubs!.status).toBe("ok");
    expect(byItem.stubs!.value).toContain("RS3_STUBS_DIR");
    expect(byItem.luals!.status).toBe("missing");
    expect(byItem.luals!.hint).toContain("LUA_LANGUAGE_SERVER");
    expect(byItem.luarc!.status).toBe("missing");
    expect(byItem.cache!.status).toBe("ok");
    expect(byItem.cache!.value).toContain("empty");
    expect(report.ok).toBe(false);
    const text = formatDoctorReport(report);
    expect(text.at(-1)).toContain("something is missing");
    expect(text.some((l) => l.startsWith("missing  luals"))).toBe(true);
  });
  it("is green when the client root, the stubs and the plugin luarc are all present", async () => {
    const base = await tempDir("rs3-doctor-ok-");
    const client = path.join(base, "client");
    await fsp.mkdir(path.join(client, "dev_plugins"), { recursive: true });
    await fsp.writeFile(path.join(client, "main.jcache"), "");
    const stubs = path.join(base, "stubs");
    await fsp.mkdir(stubs);
    const pluginDir = path.join(base, "plugin");
    await scaffoldPlugin({ dir: pluginDir, agentFiles: false, stubsDir: stubs });
    const env = { RS3_DEVTOOLS_CACHE_DIR: path.join(base, "cache"), RS3_DEV_PLUGINS_DIR: path.join(client, "dev_plugins"), RS3_STUBS_DIR: stubs };
    // Use node itself as a stand-in LuaLS binary: it answers --version with exit 0.
    const report = await runDoctor({ env, luaLanguageServer: process.execPath, pluginDir });
    const byItem = Object.fromEntries(report.rows.map((r) => [r.item, r]));
    expect(byItem.dev_plugins!.status).toBe("ok");
    expect(byItem.luals!.status).toBe("ok");
    expect(byItem.luarc!.status).toBe("ok");
    expect(report.ok).toBe(true);
    // A moved stubs folder is reported against the plugin's .luarc.json.
    await fsp.rm(stubs, { recursive: true, force: true });
    const moved = await runDoctor({ env: { ...env, RS3_STUBS_DIR: path.join(base, "elsewhere") }, luaLanguageServer: process.execPath, pluginDir });
    expect(moved.rows.find((r) => r.item === "luarc")!.status).toBe("missing");
    expect(moved.rows.find((r) => r.item === "stubs")!.status).toBe("missing");
  });
});

describe("placeholder email", () => {
  it("recognises example domains and change-me markers", () => {
    expect(isPlaceholderEmail("someone@example.com")).toBe(true);
    expect(isPlaceholderEmail("someone@mail.example.org")).toBe(true);
    expect(isPlaceholderEmail("x@example.net")).toBe(true);
    expect(isPlaceholderEmail("change-me@plugins.dev")).toBe(true);
    expect(isPlaceholderEmail(undefined)).toBe(true);
    expect(isPlaceholderEmail("support@tmhs.digital")).toBe(false);
    expect(isPlaceholderEmail("someone@examples.com")).toBe(false);
  });
  it("is a preflight warning, not an error", async () => {
    const result = await preflightPlugin(plugin("clean"));
    const finding = result.findings.find((f) => f.code === "placeholder-email");
    expect(finding?.level).toBe("warning");
    expect(result.findings.filter((f) => f.level === "error")).toEqual([]);
  });
});

describe("package", () => {
  // The fixtures use example.com addresses, so tests opt in with the test-only flag.
  const allow = { allowPlaceholderEmail: true };

  it("refuses a placeholder contactEmailAddress unless explicitly allowed", async () => {
    const out = await tempDir("rs3-zip0-");
    await expect(packagePlugin(plugin("clean"), { outDir: out })).rejects.toThrow(/placeholder-email/);
    await expect(fsp.stat(path.join(out, "clean-0.1.0.zip"))).rejects.toThrow();
  });
  it("zips plugin files at the archive root and excludes dev artefacts", async () => {
    const out = await tempDir("rs3-zip-");
    const result = await packagePlugin(plugin("clean"), { outDir: out, ...allow });
    expect(path.basename(result.outFile)).toBe("clean-0.1.0.zip");
    const entries = Object.keys(unzipSync(new Uint8Array(await fsp.readFile(result.outFile)))).sort();
    expect(entries).toEqual(["lib/helpers.lua", "main.lua", "plugin.json"]);
    expect(result.reminder).toContain("submission");
    await expect(packagePlugin(plugin("clean"), { outDir: out, ...allow })).rejects.toThrow(/already exists/);
  });
  it("leaves out OS and editor junk and .rs3ignore matches, reports sizes and a checklist", async () => {
    const base = await tempDir("rs3-zip-ignore-");
    const src = path.join(base, "junky");
    await fsp.cp(plugin("clean"), src, { recursive: true });
    await fsp.writeFile(path.join(src, "Thumbs.db"), "x");
    await fsp.writeFile(path.join(src, "main.lua.bak"), "x");
    await fsp.writeFile(path.join(src, "notes~"), "x");
    await fsp.mkdir(path.join(src, "__tests__"));
    await fsp.writeFile(path.join(src, "__tests__", "spec.lua"), "x");
    await fsp.mkdir(path.join(src, "art"));
    await fsp.writeFile(path.join(src, "art", "icon.psd"), "x");
    await fsp.writeFile(path.join(src, "art", "icon.png"), Buffer.alloc(3000, 1));
    await fsp.mkdir(path.join(src, "docs"));
    await fsp.writeFile(path.join(src, "docs", "design.md"), "x");
    await fsp.writeFile(path.join(src, "README.md"), "# for github");
    await fsp.writeFile(path.join(src, ".rs3ignore"), "# project notes\ndocs/\n*.md\n!README.md\n");
    const out = path.join(base, "out");
    const result = await packagePlugin(src, { outDir: out, allowPlaceholderEmail: true, maxBytes: 2000 });
    const entries = Object.keys(unzipSync(new Uint8Array(await fsp.readFile(result.outFile)))).sort();
    expect(entries).toEqual(["README.md", "art/icon.png", "lib/helpers.lua", "main.lua", "plugin.json"]);
    expect(result.entries[0]).toEqual({ path: "art/icon.png", bytes: 3000 });
    expect(result.contentBytes).toBeGreaterThan(3000);
    expect(result.warnings.some((w) => w.includes("limit 2.0 KB") && w.includes("art/icon.png"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("README.md ships"))).toBe(true);
    expect(result.checklist[0]).toContain("plugin.json and main.lua at the root");
    expect(result.checklist[1]).toContain("version 0.1.0");
    // sync shares the predicate.
    const root = path.join(base, "dev_plugins");
    await fsp.mkdir(root);
    const synced = await syncPlugin(src, { override: root });
    expect(synced.copied).toEqual(["README.md", "art/icon.png", "lib/helpers.lua", "main.lua", "plugin.json"]);
  });
  it("gitignore-style patterns anchor, negate and match folders", () => {
    const m = parseIgnoreFile(["*.psd", "/build-notes.txt", "scratch/", "!keep.psd", "assets/**/*.raw", "# comment", ""].join("\n"));
    expect(m.ignores("art/a.psd")).toBe(true);
    expect(m.ignores("art/keep.psd")).toBe(false);
    expect(m.ignores("build-notes.txt")).toBe(true);
    expect(m.ignores("sub/build-notes.txt")).toBe(false);
    expect(m.ignores("scratch/x.lua")).toBe(true);
    expect(m.ignores("deep/scratch/x.lua")).toBe(true);
    expect(m.ignores("assets/a/b/c.raw")).toBe(true);
    expect(m.ignores("assets/c.raw")).toBe(true);
    expect(m.ignores("main.lua")).toBe(false);
    expect(isJunk("Thumbs.db")).toBe(true);
    expect(isJunk("x/desktop.ini")).toBe(true);
    expect(isJunk("coverage/lcov.info")).toBe(true);
    expect(isJunk("resources/icon.png")).toBe(false);
  });
  it("verifies an archive built by any tool", async () => {
    const out = await tempDir("rs3-verify-");
    // A copy of the clean fixture with a real-looking address, so the archive is submission-ready.
    const src = path.join(out, "ready");
    await fsp.cp(plugin("clean"), src, { recursive: true });
    const manifest = JSON.parse(await readUtf8(path.join(src, "plugin.json")));
    manifest.contactEmailAddress = "support@fixture.invalid";
    await fsp.writeFile(path.join(src, "plugin.json"), JSON.stringify(manifest, null, 2));
    const good = await packagePlugin(src, { outDir: out });
    const ok = await verifyArchive(good.outFile);
    expect(ok.findings.filter((f) => f.level === "error")).toEqual([]);
    expect(ok.entries.map((e) => e.path).sort()).toEqual(["lib/helpers.lua", "main.lua", "plugin.json"]);
    // The placeholder fixture packaged with the test-only flag is caught by verify.
    const placeholder = await packagePlugin(plugin("clean"), { outDir: out, ...allow });
    expect((await verifyArchive(placeholder.outFile)).findings.filter((f) => f.level === "error").map((f) => f.code)).toEqual(["placeholder-email"]);
    // A hand-built archive with the usual mistakes.
    const bad = path.join(out, "bad.zip");
    const { zipSync } = await import("fflate");
    const enc = (s: string) => new TextEncoder().encode(s);
    await fsp.writeFile(
      bad,
      zipSync({
        "my-plugin/plugin.json": enc(JSON.stringify({ $schema: "x", name: "Bad", version: "1.0", contactEmailAddress: "me@example.com" })),
        "my-plugin/main.lua": enc('local h = require("lib/helpers")\nprint(h)\n'),
        "my-plugin/.luarc.json": enc("{}"),
        "my-plugin/Thumbs.db": enc("x"),
      }),
    );
    const result = await verifyArchive(bad);
    const codes = result.findings.map((f) => f.code);
    expect(codes.filter((c) => c === "archive-root")).toHaveLength(2);
    expect(result.findings.find((f) => f.code === "archive-root")!.message).toContain("my-plugin/plugin.json");
    expect(codes).toContain("archive-dev-artifact");
    expect(codes).toContain("archive-require");
    // The nested manifest is not checked (it is not at the root), so no schema findings here.
    const flat = path.join(out, "flat.zip");
    await fsp.writeFile(
      flat,
      zipSync({
        "plugin.json": enc(JSON.stringify({ $schema: "x", name: "Flat", version: "1.0", contactEmailAddress: "me@example.com" })),
        "main.lua": enc('local h = require("lib.helpers")\n'),
      }),
    );
    const flatResult = await verifyArchive(flat);
    const flatCodes = flatResult.findings.map((f) => f.code);
    expect(flatCodes).toContain("archive-schema-key");
    expect(flatCodes).toContain("placeholder-email");
    expect(flatCodes).toContain("archive-require");
    const unreadable = await verifyArchive(path.join(plugin("clean"), "main.lua"));
    expect(unreadable.findings.map((f) => f.code)).toEqual(["archive-unreadable"]);
  });
  it("ships plugin.json without $schema, four-space indented, UTF-8 without BOM, trailing newline", async () => {
    const out = await tempDir("rs3-zip3-");
    const source = path.join(out, "src");
    await fsp.cp(plugin("clean"), source, { recursive: true });
    const original = JSON.parse(await readUtf8(path.join(source, "plugin.json")));
    original.$schema = "https://example.com/schema.json";
    await fsp.writeFile(path.join(source, "plugin.json"), "\uFEFF" + JSON.stringify(original));
    const result = await packagePlugin(source, { outFile: path.join(out, "x.zip"), ...allow });
    const entry = unzipSync(new Uint8Array(await fsp.readFile(result.outFile)))["plugin.json"]!;
    expect(entry[0]).not.toBe(0xef);
    const text = Buffer.from(entry).toString("utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('\n    "name": ');
    const shipped = JSON.parse(text);
    expect(shipped).not.toHaveProperty("$schema");
    expect(shipped.name).toBe(original.name);
  });
  it("is deterministic", async () => {
    const out = await tempDir("rs3-zip2-");
    const a = await packagePlugin(plugin("clean"), { outFile: path.join(out, "a.zip"), ...allow });
    const b = await packagePlugin(plugin("clean"), { outFile: path.join(out, "b.zip"), ...allow });
    expect(await fsp.readFile(a.outFile)).toEqual(await fsp.readFile(b.outFile));
  });
});

describe("luarc stubs resolution", () => {
  it("honours RS3_STUBS_DIR and explicit overrides", async () => {
    const base = await tempDir("rs3-stubs-");
    const explicit = path.join(base, "explicit");
    const fromEnv = path.join(base, "env");
    expect(await resolveStubsDir({ stubsDir: explicit, env: { RS3_STUBS_DIR: fromEnv } })).toBe(explicit);
    expect(await resolveStubsDir({ env: { RS3_STUBS_DIR: fromEnv } })).toBe(fromEnv);
    expect(await resolveStubsDir({ env: {} })).toMatch(/luals-stubs[\\/]stubs$/);
  });
  it("writes a relative library path on the same drive and an absolute one otherwise", () => {
    // Windows-style inputs are handled with win32 semantics on every host platform.
    expect(libraryPathFor("C:/dev/plugins/my-plugin", "C:/dev/tools/stubs")).toBe("../../tools/stubs");
    expect(libraryPathFor("C:\\dev\\plugins\\my-plugin", "c:\\dev\\tools\\stubs")).toBe("../../tools/stubs");
    expect(libraryPathFor("C:/dev/my-plugin", "D:/tools/stubs")).toBe("D:/tools/stubs");
    expect(libraryPathFor("C:/dev/my-plugin", "\\\\server\\share\\stubs")).toBe("//server/share/stubs");
    // POSIX inputs use posix semantics.
    expect(libraryPathFor("/home/u/plugins/p", "/home/u/tools/stubs")).toBe("../../tools/stubs");
    expect(libraryPathFor("/home/u/plugins/p", "/home/u/plugins/p")).toBe(".");
    // Mixed flavours keep the stubs path.
    expect(libraryPathFor("/home/u/plugins/p", "D:/tools/stubs")).toBe("D:/tools/stubs");
    expect(libraryPathFor("C:/dev/my-plugin", "/opt/stubs")).toBe("/opt/stubs");
  });
});

describe("scaffold", () => {
  it("creates a plugin that passes validate and preflight", async () => {
    const base = await tempDir("rs3-init-");
    const dir = path.join(base, "my-plugin");
    const stubsDir = path.join(base, "stubs");
    const result = await scaffoldPlugin({ dir, permissions: ["httpAccess"], prettyUi: true, agentFiles: false, stubsDir });
    expect(result.files).toEqual([
      ".gitignore",
      ".luarc.json",
      ".rs3ignore",
      ".vscode/extensions.json",
      ".vscode/settings.json",
      "README.md",
      "main.lua",
      "plugin.json",
      "tests/main_test.lua",
    ]);
    // The starter test gives the dependency a stand-in, since PrettyUI is not part of the Client API.
    expect(await readUtf8(path.join(dir, "tests", "main_test.lua"))).toContain('T.dependency("PrettyUI")');
    // The editor files never ship: dotfiles by rule, README.md through the scaffolded .rs3ignore.
    expect(await readUtf8(path.join(dir, ".rs3ignore"))).toContain("README.md");
    expect(JSON.parse(await readUtf8(path.join(dir, ".vscode", "extensions.json"))).recommendations).toEqual(["sumneko.lua"]);
    const manifest = JSON.parse(await readUtf8(path.join(dir, "plugin.json")));
    expect(manifest.optionalPermissions).toEqual(["httpAccess"]);
    // httpAccess without --url: an empty urls map, never a surprise host.
    expect(manifest.urls).toEqual({});
    expect(manifest.requiredDependencies).toEqual(["PrettyUI"]);
    const main = await readUtf8(path.join(dir, "main.lua"));
    expect(main).toContain("Plugin.HasPermission(PluginPermissions.httpAccess)");
    expect(main).toContain("function PluginShutdown()");
    expect(main.charCodeAt(0)).not.toBe(0xfeff);
    const pre = await preflightPlugin(dir);
    expect(pre.findings.filter((f) => f.level === "error")).toEqual([]);
    // The stubs folder sits beside the plugin, so the entry is relative on every platform.
    const luarc = JSON.parse(await readUtf8(path.join(dir, ".luarc.json")));
    expect(luarc["workspace.library"]).toEqual(["../stubs"]);
    // PrettyUI is a dependency global no stub declares, so it must be whitelisted for
    // undefined-global (an error) and the local that reads it must actually be used.
    expect(luarc["diagnostics.globals"]).toEqual(["PrettyUI"]);
    expect(main).toContain("local prettyUi = PrettyUI");
    expect(main).toContain("if prettyUi == nil then");
  });
  it("every template passes validate and preflight and only window and event subscribe", async () => {
    const base = await tempDir("rs3-templates-");
    for (const template of SCAFFOLD_TEMPLATES) {
      const dir = path.join(base, template);
      await scaffoldPlugin({ dir, template, agentFiles: false, editorFiles: false, stubsDir: path.join(base, "stubs") });
      const main = await readUtf8(path.join(dir, "main.lua"));
      expect(main).toContain("function PluginShutdown()");
      expect(main.includes("Event.Logic.Subscribe")).toBe(template === "window" || template === "event");
      expect(main.includes("return library")).toBe(template === "library");
      const pre = await preflightPlugin(dir);
      expect(
        pre.findings.filter((f) => f.level === "error"),
        template,
      ).toEqual([]);
      expect(
        pre.findings.filter((f) => ["subscribe-without-unsubscribe", "shutdown-missing", "per-tick-scan", "component-not-destroyed"].includes(f.code)),
        template,
      ).toEqual([]);
    }
    await expect(scaffoldPlugin({ dir: path.join(base, "bad"), template: "popup" as never, agentFiles: false, stubsDir: "s" })).rejects.toThrow(
      /unknown template/,
    );
  });
  it("leaves diagnostics.globals empty without --prettyui", async () => {
    const base = await tempDir("rs3-init-plain-");
    const dir = path.join(base, "plain");
    await scaffoldPlugin({ dir, agentFiles: false, stubsDir: path.join(base, "stubs") });
    const luarc = JSON.parse(await readUtf8(path.join(dir, ".luarc.json")));
    expect(luarc["diagnostics.globals"]).toEqual([]);
    expect(await readUtf8(path.join(dir, "main.lua"))).not.toContain("PrettyUI");
  });
  it("refuses non-empty folders and unknown permissions", async () => {
    const base = await tempDir("rs3-init2-");
    await fsp.writeFile(path.join(base, "x.txt"), "");
    await expect(scaffoldPlugin({ dir: base, agentFiles: false, stubsDir: "s" })).rejects.toThrow(/not empty/);
    await expect(scaffoldPlugin({ dir: path.join(base, "p"), permissions: ["fileAccess" as never], agentFiles: false, stubsDir: "s" })).rejects.toThrow(
      /unknown permission/,
    );
  });
});

describe("docs client", () => {
  it("normalises references to relative page paths", () => {
    expect(normaliseDocsPath("https://developer.runescape.com/rs/core/persistentdb.html#get")).toBe("core/persistentdb.html");
    expect(normaliseDocsPath("./ui/component")).toBe("ui/component.html");
    expect(normaliseDocsPath("")).toBe("index.html");
    expect(() => normaliseDocsPath("https://example.com/x.html")).toThrow();
    expect(() => normaliseDocsPath("../etc/passwd")).toThrow();
  });
  it("caches with ETag and serves the cache on 304", async () => {
    const cache = await tempDir("rs3-cache-");
    let calls = 0;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls++;
      const headers = new Headers(init?.headers);
      if (headers.get("if-none-match") === '"v1"') return new Response(null, { status: 304 });
      return new Response("<html><title>T - RuneScape Client API</title><div class='md-content__inner'><h1 id='t'>T</h1><p>body</p></div></html>", {
        status: 200,
        headers: { etag: '"v1"' },
      });
    }) as typeof fetch;
    const client = new DocsClient({ cacheRoot: cache, fetchImpl });
    const first = await client.getPage("core/x.html");
    const second = await client.getPage("core/x.html");
    expect(first.source).toBe("network");
    expect(second.source).toBe("cache");
    expect(calls).toBe(2);
    const text = docsPageToText(second.html);
    expect(text.title).toBe("T");
    expect(text.text).toContain("# T");
  });
  it("fails a hung fetch within the timeout, retries 5xx once and falls back to the cache", async () => {
    const cache = await tempDir("rs3-cache-timeout-");
    const hung = (() => new Promise<Response>(() => undefined)) as typeof fetch;
    const client = new DocsClient({ cacheRoot: cache, fetchImpl: hung, timeoutMs: 50, retries: 1, retryDelayMs: 1 });
    await expect(client.getPage("core/hung.html")).rejects.toThrow(/Timed out fetching .*core\/hung\.html after 50 ms/);
    await expect(client.getPage("core/hung.html")).rejects.toBeInstanceOf(DocsFetchError);

    let calls = 0;
    const flaky = (async () => {
      calls++;
      return calls === 1 ? new Response("down", { status: 503 }) : new Response("<html><div class='md-content__inner'><p>ok</p></div></html>", { status: 200 });
    }) as typeof fetch;
    const retrying = new DocsClient({ cacheRoot: cache, fetchImpl: flaky, retries: 1, retryDelayMs: 1 });
    const page = await retrying.getPage("core/flaky.html");
    expect(page.source).toBe("network");
    expect(calls).toBe(2);

    // The page is cached now, so a hung network serves the cache instead of failing.
    const offlineLater = new DocsClient({ cacheRoot: cache, fetchImpl: hung, timeoutMs: 50, retries: 0 });
    const served = await offlineLater.getPage("core/flaky.html");
    expect(served.source).toBe("cache");
    expect(served.html).toContain("ok");
  });
  it("extracts nav links", () => {
    const html = '<nav class="md-nav"><a class="md-nav__link" href="./a/b.html">x</a><a class="md-nav__link" href="#top">y</a></nav>';
    expect(extractNavLinks(html)).toEqual(["a/b.html"]);
  });
});

describe("path safety", () => {
  it("isInside rejects escapes", () => {
    expect(isInside("C:/root", "C:/root/sub/file")).toBe(true);
    expect(isInside("C:/root", "C:/root")).toBe(true);
    expect(isInside("C:/root", "C:/root/../other")).toBe(false);
    expect(isInside("C:/root", "D:/root/sub")).toBe(false);
  });
});
