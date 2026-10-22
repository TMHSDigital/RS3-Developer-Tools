import { afterEach, describe, expect, it } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import { promises as fsp } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseUrlFlags, runCache, runDoctor, runInit, runPackage, runPreflight, runSync, runValidate } from "../commands.js";

// Reuse the core fixtures so the CLI and the library agree on their verdicts.
const coreFixtures = fileURLToPath(new URL("../../../core/src/__tests__/fixtures/plugins/", import.meta.url));
const cliEntry = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

const tempDirs: string[] = [];
async function tempDir(prefix: string): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await fsp.rm(dir, { recursive: true, force: true });
});

function capture() {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, options: { json: false, stdout: (l: string) => lines.push(l), stderr: (l: string) => errors.push(l) } };
}

describe("rs3dev commands", () => {
  it("validate exits 0 for a clean plugin and 1 for a broken one", async () => {
    const ok = capture();
    expect(await runValidate(path.join(coreFixtures, "clean"), {}, ok.options)).toBe(0);
    expect(ok.lines.at(-1)).toContain("0 error(s)");
    const bad = capture();
    expect(await runValidate(path.join(coreFixtures, "missing-main"), {}, bad.options)).toBe(1);
    expect(bad.lines.join("\n")).toContain("main-missing");
  });

  it("preflight exits 1 on sandbox violations and links the docs", async () => {
    const c = capture();
    expect(await runPreflight(path.join(coreFixtures, "sandbox"), {}, c.options)).toBe(1);
    expect(c.lines.join("\n")).toContain("see https://developer.runescape.com/rs/");
  });

  it("preflight --json prints a machine-readable report", async () => {
    const c = capture();
    await runPreflight(path.join(coreFixtures, "minified"), {}, { ...c.options, json: true });
    const report = JSON.parse(c.lines.join("\n"));
    expect(report.command).toBe("preflight");
    expect(report.findings.some((f: { code: string }) => f.code === "long-lines")).toBe(true);
  });

  it("init, sync and package work end to end", async () => {
    const base = await tempDir("rs3-cli-");
    const root = path.join(await tempDir("rs3-cli-root-"), "dev_plugins");
    await fsp.mkdir(root);
    const init = capture();
    expect(await runInit("demo-plugin", { cwd: base, agentFiles: false, stubs: "C:/stubs", permissions: "chatAccess" }, init.options)).toBe(0);
    const pluginDir = path.join(base, "demo-plugin");
    const sync = capture();
    expect(await runSync(pluginDir, { root }, sync.options)).toBe(0);
    expect(sync.lines.join("\n")).toContain("prl demo-plugin");
    expect(await fsp.stat(path.join(root, "demo-plugin", "main.lua"))).toBeTruthy();
    await expect(fsp.stat(path.join(root, "demo-plugin", ".luarc.json"))).rejects.toThrow();
    // init writes a change-me placeholder address, so package refuses until it is replaced.
    const refused = capture();
    const outFile = path.join(base, "demo.zip");
    expect(await runPackage(pluginDir, { out: outFile }, refused.options)).toBe(1);
    expect(refused.errors.join("\n")).toContain("placeholder-email");
    const pack = capture();
    expect(await runPackage(pluginDir, { out: outFile, allowPlaceholderEmail: true }, pack.options)).toBe(0);
    expect(pack.lines.join("\n")).toContain("submission");
    expect((await fsp.stat(outFile)).size).toBeGreaterThan(0);
  });

  it("init writes a .luarc.json library path relative to the plugin folder when the stubs share the drive", async () => {
    const base = await tempDir("rs3-cli-luarc-");
    const stubs = path.join(base, "stubs-here");
    await fsp.mkdir(stubs);
    expect(await runInit("rel-plugin", { cwd: base, agentFiles: false, stubs }, capture().options)).toBe(0);
    const luarc = JSON.parse(await fsp.readFile(path.join(base, "rel-plugin", ".luarc.json"), "utf8"));
    expect(luarc["workspace.library"]).toEqual(["../stubs-here"]);
  });

  it("package refuses when preflight has errors", async () => {
    const c = capture();
    expect(await runPackage(path.join(coreFixtures, "sandbox"), {}, c.options)).toBe(1);
    expect(c.errors.join("\n")).toContain("sandbox-global");
  });

  it("--strict turns warnings into a failing exit code", async () => {
    // The clean fixture has a placeholder contact address: a warning, not an error.
    const lenient = capture();
    expect(await runPreflight(path.join(coreFixtures, "clean"), {}, lenient.options)).toBe(0);
    const strict = capture();
    expect(await runPreflight(path.join(coreFixtures, "clean"), { strict: true }, strict.options)).toBe(1);
    expect(strict.lines.at(-1)).toContain("strict");
    expect(await runValidate(path.join(coreFixtures, "clean"), { strict: true }, capture().options)).toBe(0);
  });

  it("init declares urls only from --url flags", async () => {
    const base = await tempDir("rs3-cli-urls-");
    expect(await runInit("http-plain", { cwd: base, agentFiles: false, stubs: "C:/stubs", permissions: "httpAccess" }, capture().options)).toBe(0);
    const plain = JSON.parse(await fsp.readFile(path.join(base, "http-plain", "plugin.json"), "utf8"));
    expect(plain.urls).toEqual({});
    expect(await fsp.readFile(path.join(base, "http-plain", "main.lua"), "utf8")).toContain("None declared yet");
    expect(
      await runInit("http-urls", { cwd: base, agentFiles: false, stubs: "C:/stubs", permissions: "httpAccess", url: ["wiki=https://runescape.wiki/", "api=https://api.example.test/v1/"] }, capture().options),
    ).toBe(0);
    const withUrls = JSON.parse(await fsp.readFile(path.join(base, "http-urls", "plugin.json"), "utf8"));
    expect(withUrls.urls).toEqual({ api: "https://api.example.test/v1/", wiki: "https://runescape.wiki/" });
    expect(await fsp.readFile(path.join(base, "http-urls", "main.lua"), "utf8")).toContain("Plugin.urls.api, Plugin.urls.wiki");
    expect(() => parseUrlFlags(["ftp://nope"])).toThrow(/name=https/);
    expect(() => parseUrlFlags(["api=ftp://nope"])).toThrow(/not an http or https URL/);
    const bad = capture();
    expect(await runInit("http-bad", { cwd: base, agentFiles: false, stubs: "C:/stubs", url: ["x"] }, bad.options)).toBe(1);
  });

  it("doctor prints a report, exits 1 when something is missing, and cache path/clear work", async () => {
    const base = await tempDir("rs3-cli-doctor-");
    const cache = path.join(base, "cache");
    await fsp.mkdir(path.join(cache, "docs"), { recursive: true });
    await fsp.writeFile(path.join(cache, "docs", "x.html"), "<html></html>");
    const previous = { cache: process.env.RS3_DEVTOOLS_CACHE_DIR, luals: process.env.LUA_LANGUAGE_SERVER, root: process.env.RS3_DEV_PLUGINS_DIR };
    process.env.RS3_DEVTOOLS_CACHE_DIR = cache;
    process.env.LUA_LANGUAGE_SERVER = path.join(base, "missing-luals");
    delete process.env.RS3_DEV_PLUGINS_DIR;
    try {
      const c = capture();
      await runDoctor(undefined, { stubs: "C:/stubs-not-here" }, { ...c.options, json: true });
      const report = JSON.parse(c.lines.join("\n"));
      expect(report.command).toBe("doctor");
      expect(report.rows.map((r: { item: string }) => r.item)).toEqual(["node", "dev_plugins", "stubs", "luals", "cache"]);
      expect(report.ok).toBe(false);
      const text = capture();
      expect(await runDoctor(undefined, { stubs: "C:/stubs-not-here" }, text.options)).toBe(1);
      expect(text.lines.join("\n")).toContain("missing  luals");
      const p = capture();
      expect(await runCache("path", p.options)).toBe(0);
      expect(p.lines[0]).toBe(path.join(cache, "docs"));
      const clear = capture();
      expect(await runCache("clear", clear.options)).toBe(0);
      expect(clear.lines[0]).toContain("Removed 1 cached file(s)");
      await expect(fsp.stat(path.join(cache, "docs"))).rejects.toThrow();
      expect(await runCache("nope", capture().options)).toBe(1);
    } finally {
      if (previous.cache === undefined) delete process.env.RS3_DEVTOOLS_CACHE_DIR;
      else process.env.RS3_DEVTOOLS_CACHE_DIR = previous.cache;
      if (previous.luals === undefined) delete process.env.LUA_LANGUAGE_SERVER;
      else process.env.LUA_LANGUAGE_SERVER = previous.luals;
      if (previous.root !== undefined) process.env.RS3_DEV_PLUGINS_DIR = previous.root;
    }
  });

  it("the built binary prints help", async () => {
    const exists = await fsp.stat(cliEntry).then(() => true, () => false);
    if (!exists) return; // build has not run yet; the library tests above cover the logic
    const result = spawnSync(process.execPath, [cliEntry, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("preflight");
  });
});
