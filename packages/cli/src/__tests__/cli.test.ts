import { afterEach, describe, expect, it } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import { promises as fsp } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runInit, runPackage, runPreflight, runSync, runValidate } from "../commands.js";

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
    expect(await runValidate(path.join(coreFixtures, "clean"), ok.options)).toBe(0);
    expect(ok.lines.at(-1)).toContain("0 error(s)");
    const bad = capture();
    expect(await runValidate(path.join(coreFixtures, "missing-main"), bad.options)).toBe(1);
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

  it("the built binary prints help", async () => {
    const exists = await fsp.stat(cliEntry).then(() => true, () => false);
    if (!exists) return; // build has not run yet; the library tests above cover the logic
    const result = spawnSync(process.execPath, [cliEntry, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("preflight");
  });
});
