// rs3dev test: run a plugin's Lua tests outside the client against the API
// fakes generated from the stubs (fakes/rs3_api_fakes.lua) and the test
// runtime (test-runtime/rs3_test.lua), both shipped with @tmhs/rs3-luals-stubs.
//
// Two engines run the same bootstrap:
//   - wasmoon (Lua 5.4 compiled to WebAssembly, bundled): no install step. The
//     plugin's Lua files, plugin.json, the fakes and the runtime are mounted
//     into its virtual file system so require("ui_helpers") resolves as it does
//     in the client.
//   - a native interpreter (--lua <exe> or RS3_LUA): spawned with the real paths.
// Results come back as tab-separated RS3TEST lines, so both engines are parsed
// the same way.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import * as path from "node:path";
import { listFilesRecursive, pathExists, readUtf8 } from "./fs.js";
import { type StubsResolveOptions, stubsPackageDir } from "./luarc.js";
import { isDevArtifact } from "./manifest.js";

export const TEST_DIRS = ["tests", "spec"];

export interface PluginTestOptions extends StubsResolveOptions {
  /** Path to a native Lua 5.4 interpreter; the bundled WebAssembly build is used when absent. */
  lua?: string;
}

export interface PluginTestCase {
  file: string;
  name: string;
  ok: boolean;
  message?: string;
}

export interface PluginTestResult {
  pluginDir: string;
  engine: "wasmoon" | "lua";
  /** Test files run, relative to the plugin folder. */
  files: string[];
  tests: PluginTestCase[];
  passed: number;
  failed: number;
  /** Everything the tests printed that was not a result line. */
  output: string[];
}

/** Lua files under tests/ or spec/, sorted, relative to the plugin folder with forward slashes. */
export async function findPluginTests(pluginDir: string): Promise<string[]> {
  const files: string[] = [];
  for (const dir of TEST_DIRS) {
    const full = path.join(pluginDir, dir);
    if (!(await pathExists(full))) continue;
    for (const rel of await listFilesRecursive(full)) {
      if (rel.endsWith(".lua")) files.push(`${dir}/${rel.replace(/\\/g, "/")}`);
    }
  }
  return files.sort();
}

/** Folder holding fakes/ and test-runtime/: beside RS3_STUBS_DIR or the installed stubs package. */
async function fakesRoot(options: StubsResolveOptions): Promise<string> {
  const env = options.env ?? process.env;
  if (options.stubsDir) {
    const beside = path.resolve(options.stubsDir, "..");
    if (await pathExists(path.join(beside, "fakes", "rs3_api_fakes.lua"))) return beside;
  }
  if (env.RS3_STUBS_DIR) {
    const beside = path.resolve(env.RS3_STUBS_DIR, "..");
    if (await pathExists(path.join(beside, "fakes", "rs3_api_fakes.lua"))) return beside;
  }
  return stubsPackageDir(options);
}

/**
 * The Lua that drives a run. Globals set by the engine: RS3_PLUGIN_ROOT,
 * RS3_FAKES_DIR, RS3_RUNTIME_DIR (forward slashes), RS3_TEST_FILES (list),
 * RS3_PLUGIN_PERMISSIONS (comma separated) and, under wasmoon, __rs3_emit.
 */
const BOOTSTRAP = String.raw`
local emit = rawget(_G, "__rs3_emit") or function(line)
  io.stdout:write(line, "\n")
  io.stdout:flush()
end
local function printLine(...)
  local parts = {}
  for i = 1, select("#", ...) do
    parts[i] = tostring((select(i, ...)))
  end
  emit(table.concat(parts, "\t"))
end
package.path = RS3_PLUGIN_ROOT .. "/?.lua;" .. RS3_PLUGIN_ROOT .. "/?/init.lua;" .. RS3_FAKES_DIR .. "/?.lua;" .. RS3_RUNTIME_DIR .. "/?.lua"
local T = require("rs3_test")
-- After the fakes: the docs list print as an API function, so the fakes define a recording one.
print = printLine
for _, file in ipairs(RS3_TEST_FILES) do
  T._set_file(file)
  local chunk, err = loadfile(RS3_PLUGIN_ROOT .. "/" .. file)
  if not chunk then
    emit("RS3TEST\tfail\t" .. file .. "\t(load)\t" .. tostring(err):gsub("\n", "\\n"))
  else
    local ok, loadErr = xpcall(chunk, debug.traceback)
    if not ok then
      emit("RS3TEST\tfail\t" .. file .. "\t(load)\t" .. tostring(loadErr):gsub("\n", "\\n"))
    end
  end
end
local passed, failed = T.run(emit)
emit("RS3SUMMARY\t" .. passed .. "\t" .. failed)
`;

function parseLines(lines: string[], result: PluginTestResult): void {
  for (const line of lines) {
    if (line.startsWith("RS3TEST\t")) {
      const [, status, file, name, message] = line.split("\t");
      const ok = status === "ok";
      result.tests.push({ file: file ?? "", name: name ?? "", ok, ...(ok ? {} : { message: (message ?? "").replace(/\\n/g, "\n") }) });
      if (ok) result.passed++;
      else result.failed++;
    } else if (line.startsWith("RS3SUMMARY\t")) {
      // Counts are derived from the lines; the summary only confirms the run finished.
    } else if (line.length > 0) {
      result.output.push(line);
    }
  }
}

/** Collect the plugin's Lua files and manifest for mounting (dev artefacts stay out, tests stay in). */
async function pluginFiles(pluginDir: string): Promise<string[]> {
  const files = await listFilesRecursive(pluginDir);
  return files
    .map((rel) => rel.replace(/\\/g, "/"))
    .filter((rel) => rel === "plugin.json" || (rel.endsWith(".lua") && (TEST_DIRS.some((d) => rel.startsWith(`${d}/`)) || !isDevArtifact(rel))));
}

async function permissionsOf(pluginDir: string): Promise<string> {
  try {
    const manifest = JSON.parse(await readUtf8(path.join(pluginDir, "plugin.json"))) as { requiredPermissions?: string[]; optionalPermissions?: string[] };
    return [...(manifest.requiredPermissions ?? []), ...(manifest.optionalPermissions ?? [])].join(",");
  } catch {
    return "";
  }
}

async function runWithWasmoon(pluginDir: string, files: string[], fakes: string, permissions: string, result: PluginTestResult): Promise<void> {
  const { LuaFactory } = await import("wasmoon");
  const require = createRequire(import.meta.url);
  const wasm = path.join(path.dirname(require.resolve("wasmoon")), "glue.wasm");
  const factory = new LuaFactory(wasm);
  for (const rel of await pluginFiles(pluginDir)) {
    await factory.mountFile(`/plugin/${rel}`, await readUtf8(path.join(pluginDir, rel)));
  }
  await factory.mountFile("/fakes/rs3_api_fakes.lua", await readUtf8(path.join(fakes, "fakes", "rs3_api_fakes.lua")));
  await factory.mountFile("/runtime/rs3_test.lua", await readUtf8(path.join(fakes, "test-runtime", "rs3_test.lua")));
  const engine = await factory.createEngine({ openStandardLibs: true, injectObjects: false });
  const lines: string[] = [];
  try {
    engine.global.set("__rs3_emit", (line: string) => {
      lines.push(String(line));
    });
    engine.global.set("RS3_PLUGIN_ROOT", "/plugin");
    engine.global.set("RS3_FAKES_DIR", "/fakes");
    engine.global.set("RS3_RUNTIME_DIR", "/runtime");
    engine.global.set("RS3_TEST_FILES", files);
    engine.global.set("RS3_PLUGIN_PERMISSIONS", permissions);
    await engine.doString(BOOTSTRAP);
  } finally {
    engine.global.close();
  }
  parseLines(lines, result);
}

function runWithNativeLua(lua: string, pluginDir: string, files: string[], fakes: string, permissions: string, result: PluginTestResult): void {
  const slashes = (p: string) => p.replace(/\\/g, "/");
  const prelude = [
    `RS3_PLUGIN_ROOT = ${JSON.stringify(slashes(pluginDir))}`,
    `RS3_FAKES_DIR = ${JSON.stringify(slashes(path.join(fakes, "fakes")))}`,
    `RS3_RUNTIME_DIR = ${JSON.stringify(slashes(path.join(fakes, "test-runtime")))}`,
    `RS3_TEST_FILES = { ${files.map((f) => JSON.stringify(f)).join(", ")} }`,
    `RS3_PLUGIN_PERMISSIONS = ${JSON.stringify(permissions)}`,
  ].join("\n");
  const run = spawnSync(lua, ["-"], { input: `${prelude}\n${BOOTSTRAP}`, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.error) throw new Error(`could not start ${lua}: ${run.error.message}`);
  parseLines(`${run.stdout}\n${run.stderr}`.split(/\r?\n/), result);
  if (run.status !== 0 && result.tests.length === 0) {
    throw new Error(`${lua} exited with ${run.status}: ${(run.stderr || run.stdout).trim()}`);
  }
}

/** Run every test file of a plugin. Throws when the plugin has no tests or the fakes cannot be found. */
export async function runPluginTests(pluginDir: string, options: PluginTestOptions = {}): Promise<PluginTestResult> {
  const dir = path.resolve(pluginDir);
  if (!(await pathExists(path.join(dir, "main.lua")))) throw new Error(`${dir} has no main.lua`);
  const files = await findPluginTests(dir);
  if (files.length === 0) {
    throw new Error(`no tests found under ${TEST_DIRS.map((d) => `${d}/`).join(" or ")} in ${dir}; create tests/<name>_test.lua (see the add-tests skill)`);
  }
  const fakes = await fakesRoot(options);
  for (const required of [path.join("fakes", "rs3_api_fakes.lua"), path.join("test-runtime", "rs3_test.lua")]) {
    if (!(await pathExists(path.join(fakes, required)))) {
      throw new Error(`${path.join(fakes, required)} is missing; update @tmhs/rs3-luals-stubs or run npm run stubs:generate`);
    }
  }
  const permissions = await permissionsOf(dir);
  const lua = options.lua ?? (options.env ?? process.env).RS3_LUA;
  const result: PluginTestResult = { pluginDir: dir, engine: lua ? "lua" : "wasmoon", files, tests: [], passed: 0, failed: 0, output: [] };
  if (lua) runWithNativeLua(lua, dir, files, fakes, permissions, result);
  else await runWithWasmoon(dir, files, fakes, permissions, result);
  return result;
}

/** Human-readable report lines. */
export function formatTestReport(result: PluginTestResult): string[] {
  const lines: string[] = [];
  for (const test of result.tests) {
    lines.push(`${test.ok ? "ok  " : "FAIL"} ${test.file}: ${test.name}`);
    if (!test.ok && test.message) for (const line of test.message.split("\n")) lines.push(`       ${line}`);
  }
  for (const line of result.output) lines.push(`     | ${line}`);
  const total = result.passed + result.failed;
  lines.push(`${result.passed} of ${total} test(s) passed in ${result.files.length} file(s) (${result.engine})`);
  return lines;
}
