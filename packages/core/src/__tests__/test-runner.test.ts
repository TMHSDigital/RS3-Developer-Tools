import { promises as fsp } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { findPluginTests, formatTestReport, runPluginTests } from "../test-runner.js";

// rs3dev test runs plugin Lua against the fakes generated from the stubs. These
// tests use the committed fakes and the bundled WebAssembly Lua, so they need
// no interpreter and no client.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const stubsDir = path.join(repoRoot, "packages", "luals-stubs", "stubs");

const tempDirs: string[] = [];
async function plugin(files: Record<string, string>): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "rs3-test-runner-"));
  tempDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    await fsp.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fsp.writeFile(path.join(dir, rel), content);
  }
  return dir;
}
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await fsp.rm(dir, { recursive: true, force: true });
});

const MANIFEST = JSON.stringify({ name: "Fixture", version: "0.1.0", contactEmailAddress: "fixture@example.com", optionalPermissions: ["chatAccess"] });

describe("runPluginTests", () => {
  it("passes the reference plugin's tests under the bundled Lua", async () => {
    const result = await runPluginTests(path.join(repoRoot, "examples", "hello-counter"), { stubsDir });
    expect(result.engine).toBe("wasmoon");
    expect(result.files).toEqual(["tests/counter_test.lua"]);
    expect(result.tests.filter((t) => !t.ok).map((t) => `${t.name}: ${t.message}`)).toEqual([]);
    expect(result.passed).toBeGreaterThanOrEqual(6);
    expect(result.failed).toBe(0);
  }, 60000);

  it("reports failures with the plugin line, load errors per file, and keeps printed output", async () => {
    const dir = await plugin({
      "plugin.json": MANIFEST,
      "main.lua": [
        "local helper = require('lib/helper')",
        "counter = helper.start",
        "Event.Logic.Subscribe('fixture.logic', function(e) counter = counter + e.logicTick end)",
        "function PluginShutdown() Event.Logic.Unsubscribe('fixture.logic') end",
        "",
      ].join("\n"),
      "lib/helper.lua": "return { start = 10 }\n",
      "tests/a_test.lua": [
        "local T = require('rs3_test')",
        "T.test('logic adds ticks', function()",
        "  T.load()",
        "  T.emit('Logic', { logicTick = 5 })",
        "  T.assert.equals(15, counter)",
        "  T.assert.equals({ { event = 'Logic', ref = 'fixture.logic' } }, T.subscriptions())",
        "  T.shutdown()",
        "  T.assert.equals({}, T.subscriptions())",
        "end)",
        "T.test('permissions come from plugin.json', function()",
        "  T.assert.is_true(Plugin:HasPermission('chatAccess'))",
        "  T.assert.is_false(Plugin:HasPermission('fileAccess'))",
        "end)",
        "T.test('payload fields default to their documented types', function()",
        "  T.load()",
        "  local seen",
        "  Event.NPCEntityAdded.Subscribe('fixture.npc', function(e) seen = e end)",
        "  T.emit('NPCEntityAdded', { npcEntity = { displayName = 'Goblin' } })",
        "  T.assert.equals('Goblin', seen.npcEntity.displayName)",
        "  T.assert.equals(true, seen.npcEntity.isValid == false or seen.npcEntity.isValid == true)",
        "  T.assert.equals(0, seen.entityType)",
        "  T.assert.equals(0, seen.npcEntity.config.id)",
        "end)",
        "T.test('this one fails', function()",
        "  print('about to fail')",
        "  T.assert.equals(1, 2, 'one is not two')",
        "end)",
        "",
      ].join("\n"),
      "tests/b_test.lua": "local T = require('rs3_test')\nT.test('never registered', function() end\n",
    });
    const result = await runPluginTests(dir, { stubsDir });
    expect(result.files).toEqual(["tests/a_test.lua", "tests/b_test.lua"]);
    const byName = Object.fromEntries(result.tests.map((t) => [t.name, t]));
    expect(byName["logic adds ticks"]?.ok, byName["logic adds ticks"]?.message).toBe(true);
    expect(byName["permissions come from plugin.json"]?.ok, byName["permissions come from plugin.json"]?.message).toBe(true);
    expect(byName["payload fields default to their documented types"]?.ok, byName["payload fields default to their documented types"]?.message).toBe(true);
    expect(byName["this one fails"]?.ok).toBe(false);
    expect(byName["this one fails"]?.message).toContain("one is not two: expected 1, got 2");
    expect(byName["this one fails"]?.message).toContain("tests/a_test.lua");
    expect(byName["(load)"]?.file).toBe("tests/b_test.lua");
    expect(byName["(load)"]?.message).toMatch(/expected|near/);
    expect(result.output).toEqual(["about to fail"]);
    expect(result.passed).toBe(3);
    expect(result.failed).toBe(2);
    const report = formatTestReport(result);
    // Load failures surface as soon as the file is read, before the registered tests run.
    expect(report[0]).toBe("FAIL tests/b_test.lua: (load)");
    expect(report).toContain("ok   tests/a_test.lua: logic adds ticks");
    expect(report).toContain("     | about to fail");
    expect(report.at(-1)).toBe("3 of 5 test(s) passed in 2 file(s) (wasmoon)");
  }, 60000);

  it("refuses a plugin without tests or without main.lua", async () => {
    const empty = await plugin({ "plugin.json": MANIFEST, "main.lua": "" });
    await expect(runPluginTests(empty, { stubsDir })).rejects.toThrow(/no tests found/);
    const noMain = await plugin({ "plugin.json": MANIFEST, "tests/a_test.lua": "" });
    await expect(runPluginTests(noMain, { stubsDir })).rejects.toThrow(/no main\.lua/);
  });

  it("finds tests under tests/ and spec/ in sorted order with forward slashes", async () => {
    const dir = await plugin({ "main.lua": "", "spec/z_spec.lua": "", "tests/nested/deep_test.lua": "", "tests/a_test.lua": "", "tests/notes.md": "" });
    expect(await findPluginTests(dir)).toEqual(["spec/z_spec.lua", "tests/a_test.lua", "tests/nested/deep_test.lua"]);
  });
});
