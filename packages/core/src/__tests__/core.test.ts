import { afterEach, describe, expect, it } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import { promises as fsp } from "node:fs";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { readUtf8 } from "../fs.js";
import { validateManifestObject, validatePluginDir, isDevArtifact } from "../manifest.js";
import { preflightPlugin } from "../preflight.js";
import { scanLua, globalReads, memberChains } from "../lua-scan.js";
import { syncPlugin } from "../sync.js";
import { packagePlugin } from "../package.js";
import { scaffoldPlugin } from "../scaffold.js";
import { findDevPluginsRoot } from "../paths.js";
import { normaliseDocsPath, DocsClient } from "../docs-client.js";
import { docsPageToText, extractNavLinks } from "../docs-text.js";
import { isInside } from "../fs.js";

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
  it("collects member chains", () => {
    const chains = memberChains(scanLua("Event.ChatMessage.Subscribe('a', f)\nlocal r = HTTPRequest.new(u)\nobj:Method()")).map((c) => c.chain);
    expect(chains).toEqual(["Event.ChatMessage.Subscribe", "HTTPRequest.new", "obj:Method"]);
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
    ]);
    expect(sandbox[0]!.line).toBe(4);
    expect(sandbox[0]!.docsUrl).toContain("guidelines");
  });
  it("flags chat and tracking use without the permission", async () => {
    const result = await preflightPlugin(plugin("chat-no-permission"));
    expect(codes(result.findings)).toContain("chat-permission");
    expect(codes(result.findings)).toContain("tracking-permission");
  });
  it("flags URL literals outside the manifest urls", async () => {
    const result = await preflightPlugin(plugin("http-outside-urls"));
    const outside = result.findings.filter((f) => f.code === "url-outside-manifest");
    expect(outside).toHaveLength(1);
    expect(outside[0]!.message).toContain("example.org");
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
  it("reports a missing main.lua as an error", async () => {
    const result = await preflightPlugin(plugin("missing-main"));
    expect(codes(result.findings)).toContain("main-missing");
  });
});

describe("sync", () => {
  it("copies into dev_plugins, excludes dev artefacts, prunes stale files and prints the reload command", async () => {
    const root = await tempDir("rs3-devplugins-");
    const stale = path.join(root, "clean", "old.lua");
    await fsp.mkdir(path.dirname(stale), { recursive: true });
    await fsp.writeFile(stale, "-- stale");
    const result = await syncPlugin(plugin("clean"), { override: root });
    expect(result.consoleCommand).toBe("prl clean");
    expect(result.copied).toEqual(["lib/helpers.lua", "main.lua", "plugin.json"]);
    expect(result.removed).toEqual(["old.lua"]);
    expect(await readUtf8(path.join(root, "clean", "main.lua"))).toContain("Clean fixture");
  });
  it("honours RS3_DEV_PLUGINS_DIR and detects a client root by *.jcache files", async () => {
    const env = await tempDir("rs3-env-");
    expect((await findDevPluginsRoot({ env: { RS3_DEV_PLUGINS_DIR: env } })).source).toBe("env");
    const client = await tempDir("rs3-client-");
    await fsp.writeFile(path.join(client, "main.jcache"), "");
    const detected = await findDevPluginsRoot({ env: {}, candidateClientRoots: [client] });
    expect(detected.source).toBe("detected");
    expect(detected.root).toBe(path.join(client, "dev_plugins"));
    await expect(findDevPluginsRoot({ env: {}, candidateClientRoots: [env] })).rejects.toThrow(/jcache/);
  });
});

describe("package", () => {
  it("zips plugin files at the archive root and excludes dev artefacts", async () => {
    const out = await tempDir("rs3-zip-");
    const result = await packagePlugin(plugin("clean"), { outDir: out });
    expect(path.basename(result.outFile)).toBe("clean-0.1.0.zip");
    const entries = Object.keys(unzipSync(new Uint8Array(await fsp.readFile(result.outFile)))).sort();
    expect(entries).toEqual(["lib/helpers.lua", "main.lua", "plugin.json"]);
    expect(result.reminder).toContain("submission");
    await expect(packagePlugin(plugin("clean"), { outDir: out })).rejects.toThrow(/already exists/);
  });
  it("is deterministic", async () => {
    const out = await tempDir("rs3-zip2-");
    const a = await packagePlugin(plugin("clean"), { outFile: path.join(out, "a.zip") });
    const b = await packagePlugin(plugin("clean"), { outFile: path.join(out, "b.zip") });
    expect(await fsp.readFile(a.outFile)).toEqual(await fsp.readFile(b.outFile));
  });
});

describe("scaffold", () => {
  it("creates a plugin that passes validate and preflight", async () => {
    const base = await tempDir("rs3-init-");
    const dir = path.join(base, "my-plugin");
    const result = await scaffoldPlugin({ dir, permissions: ["httpAccess"], prettyUi: true, agentFiles: false, stubsDir: "C:/stubs" });
    expect(result.files).toEqual([".luarc.json", "main.lua", "plugin.json"]);
    const manifest = JSON.parse(await readUtf8(path.join(dir, "plugin.json")));
    expect(manifest.optionalPermissions).toEqual(["httpAccess"]);
    expect(manifest.requiredDependencies).toEqual(["PrettyUI"]);
    const main = await readUtf8(path.join(dir, "main.lua"));
    expect(main).toContain("Plugin.HasPermission(PluginPermissions.httpAccess)");
    expect(main).toContain("function PluginShutdown()");
    expect(main.charCodeAt(0)).not.toBe(0xfeff);
    const pre = await preflightPlugin(dir);
    expect(pre.findings.filter((f) => f.level === "error")).toEqual([]);
    expect(JSON.parse(await readUtf8(path.join(dir, ".luarc.json")))["workspace.library"]).toEqual(["C:/stubs"]);
  });
  it("refuses non-empty folders and unknown permissions", async () => {
    const base = await tempDir("rs3-init2-");
    await fsp.writeFile(path.join(base, "x.txt"), "");
    await expect(scaffoldPlugin({ dir: base, agentFiles: false, stubsDir: "s" })).rejects.toThrow(/not empty/);
    await expect(scaffoldPlugin({ dir: path.join(base, "p"), permissions: ["fileAccess" as never], agentFiles: false, stubsDir: "s" })).rejects.toThrow(/unknown permission/);
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
