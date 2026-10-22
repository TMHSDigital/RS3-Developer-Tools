import { afterEach, describe, expect, it } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import { promises as fsp } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseUrlFlags, runAdopt, runCache, runDoctor, runInit, runLuarc, runPackage, runPreflight, runStubs, runSync, runValidate } from "../commands.js";

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
    expect(await runPackage(pluginDir, { out: outFile, allowPlaceholderEmail: true, list: true }, pack.options)).toBe(0);
    const packed = pack.lines.join("\n");
    expect(packed).toContain("submission");
    expect(packed).toContain("Before uploading:");
    expect(packed).toContain("1. Archive:");
    expect(packed).toMatch(/\d+  main\.lua/);
    expect((await fsp.stat(outFile)).size).toBeGreaterThan(0);
    // --verify inspects the archive just built: the scaffold's placeholder address is its one error.
    const verify = capture();
    expect(await runPackage(".", { verify: outFile }, verify.options)).toBe(1);
    expect(verify.lines.at(-1)).toMatch(/^verify: 1 error\(s\)/);
    expect(verify.lines.join("\n")).toContain("[placeholder-email]");
    const verifyJson = capture();
    await runPackage(".", { verify: outFile }, { ...verifyJson.options, json: true });
    expect(JSON.parse(verifyJson.lines.join("\n")).command).toBe("verify");
    expect(await runPackage(".", { verify: path.join(pluginDir, "main.lua") }, capture().options)).toBe(1);
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

  it("--format github and sarif render findings for CI, --ignore drops codes", async () => {
    const gh = capture();
    expect(await runPreflight(path.join(coreFixtures, "sandbox"), { format: "github" }, gh.options)).toBe(1);
    expect(gh.lines[0]).toMatch(/^::error file=main\.lua,line=4,title=sandbox-global::/);
    const sarif = capture();
    await runPreflight(path.join(coreFixtures, "sandbox"), { format: "sarif" }, sarif.options);
    const log = JSON.parse(sarif.lines.join("\n"));
    expect(log.version).toBe("2.1.0");
    expect(log.runs[0].tool.driver.name).toBe("rs3dev");
    expect(log.runs[0].results.some((r: { ruleId: string }) => r.ruleId === "sandbox-global")).toBe(true);
    const ignored = capture();
    expect(await runPreflight(path.join(coreFixtures, "sandbox"), { ignore: "sandbox-global", format: "json" }, ignored.options)).toBe(0);
    const report = JSON.parse(ignored.lines.join("\n"));
    expect(report.findings.some((f: { code: string }) => f.code === "sandbox-global")).toBe(false);
    expect(report.suppressed.length).toBeGreaterThan(0);
    const bad = capture();
    expect(await runPreflight(path.join(coreFixtures, "sandbox"), { format: "xml" }, bad.options)).toBe(1);
    expect(bad.errors[0]).toContain("unknown --format");
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

  it("adopt and luarc bring an existing folder in without touching its code", async () => {
    const base = await tempDir("rs3-cli-adopt-");
    const dir = path.join(base, "mine");
    await fsp.cp(path.join(coreFixtures, "clean"), dir, { recursive: true });
    const stubs = path.join(base, "stubs");
    await fsp.mkdir(stubs);
    await fsp.writeFile(path.join(stubs, "_globals.lua"), "---@meta\n");
    const c = capture();
    expect(await runAdopt(dir, { stubs }, c.options)).toBe(0);
    expect(c.lines.join("\n")).toContain("AGENTS.md");
    expect(c.lines.join("\n")).toContain("specific to this machine");
    expect(await fsp.readFile(path.join(dir, "main.lua"), "utf8")).toContain("Clean fixture");
    const v = capture();
    expect(await runLuarc(dir, { stubs, vendor: true }, v.options)).toBe(0);
    expect(v.lines.join("\n")).toContain("./.rs3/stubs");
    expect(await runAdopt(path.join(base, "nothing"), {}, capture().options)).toBe(1);
  });

  it("stubs status reports the installed stubs against the live docs index", async () => {
    const notModified = (async () => new Response(null, { status: 304 })) as typeof fetch;
    const c = capture();
    expect(await runStubs("status", { fetchImpl: notModified }, { ...c.options, json: true })).toBe(0);
    const report = JSON.parse(c.lines.join("\n"));
    expect(report.command).toBe("stubs");
    expect(report.modules).toBeGreaterThan(50);
    expect(["current", "unknown"]).toContain(report.status);
    const changed = (async () => new Response("<html></html>", { status: 200, headers: { etag: '"different"' } })) as typeof fetch;
    const text = capture();
    const code = await runStubs("status", { fetchImpl: changed }, text.options);
    expect([0, 2]).toContain(code); // 2 when the committed index carries an ETag, 0 (unknown) when it does not
    expect(await runStubs("nope", {}, capture().options)).toBe(1);
  });

  it("the built binary prints help", async () => {
    const exists = await fsp.stat(cliEntry).then(() => true, () => false);
    if (!exists) return; // build has not run yet; the library tests above cover the logic
    const result = spawnSync(process.execPath, [cliEntry, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("preflight");
  });
});
