// Run lua-language-server --check against a plugin folder and fail on any
// undefined-global, undefined-field, or type diagnostics.
//
// Usage: node scripts/luals-check.mjs <plugin dir> [--bin <lua-language-server>]
//
// The binary is found from --bin, the LUA_LANGUAGE_SERVER environment variable,
// or PATH. CI downloads a pinned release; see .github/workflows/ci.yml.
// The .luarc.json inside the plugin folder is rewritten into a temporary copy
// with the workspace.library path made absolute, because LuaLS resolves
// relative library paths against the current directory on some platforms.
//
// parseDiagnostics and isBlocking are exported so the parsing is unit tested
// (tests/scripts.test.ts) without a LuaLS binary.

import { spawnSync } from "node:child_process";
import { promises as fsp, realpathSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const BLOCKING_CODES = new Set([
  "undefined-global",
  "undefined-field",
  "param-type-mismatch",
  "assign-type-mismatch",
  "return-type-mismatch",
  "cast-type-mismatch",
  "undefined-doc-name",
  "missing-parameter",
]);

// ANSI colour sequences, built without a control character in the regex source.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function inferCode(message) {
  if (/^Cannot assign .* to parameter/.test(message)) return "param-type-mismatch";
  if (/^Cannot assign/.test(message)) return "assign-type-mismatch";
  return "unknown";
}

/**
 * Parse LuaLS --check output into diagnostics.
 *
 * LuaLS prints one line per diagnostic: "<file>:<line>:<col> [<severity>] <message> (<code>)".
 * Progress output ("Initializing ...", the >>>> bar) ends with a bare carriage
 * return and the first diagnostic follows it on the same line, so the output
 * is split on every line-ending flavour or that diagnostic is silently dropped.
 */
export function parseDiagnostics(output) {
  const seen = new Set();
  const problems = [];
  for (const line of output.replace(ANSI, "").split(/\r\n|\r|\n/)) {
    const m = /^(.+?):(\d+):(\d+) \[(\w+)\] (.*?)(?: \(([\w-]+)\))?\s*$/.exec(line.trim());
    if (!m) continue;
    const key = `${m[1]}:${m[2]}:${m[3]}:${m[5]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push({ file: m[1], line: Number(m[2]), severity: m[4], message: m[5], code: m[6] ?? inferCode(m[5]) });
  }
  return problems;
}

/** A diagnostic that fails the check: every Error, plus the type codes above at any severity. */
export function isBlocking(problem) {
  return problem.severity === "Error" || BLOCKING_CODES.has(problem.code);
}

async function main(argv) {
  const target = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--bin");
  if (!target) {
    console.error("usage: node scripts/luals-check.mjs <plugin dir> [--bin <lua-language-server>]");
    return 2;
  }
  const binIndex = argv.indexOf("--bin");
  const bin = binIndex >= 0 ? argv[binIndex + 1] : (process.env.LUA_LANGUAGE_SERVER ?? "lua-language-server");

  const workspace = path.resolve(target);
  const luarcPath = path.join(workspace, ".luarc.json");
  const luarc = JSON.parse(await fsp.readFile(luarcPath, "utf8"));
  const libraries = (luarc["workspace.library"] ?? []).map((lib) => path.resolve(workspace, lib).replace(/\\/g, "/"));
  const config = { ...luarc, "workspace.library": libraries };

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "rs3-luals-"));
  const configPath = path.join(tmp, "luarc.json");
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2));

  const lualsArgs = ["--check", workspace, "--configpath", configPath, "--checklevel", "Warning", "--logpath", path.join(tmp, "log")];
  const runLuals = (useShell) => {
    // With a shell (Windows .cmd shims) pass one quoted command string so Node
    // does not warn about unescaped arguments (DEP0190).
    if (useShell) return spawnSync([bin, ...lualsArgs].map((a) => `"${a}"`).join(" "), { encoding: "utf8", shell: true });
    return spawnSync(bin, lualsArgs, { encoding: "utf8" });
  };
  // Prefer a direct spawn; fall back to the shell for .cmd shims on Windows.
  let result = runLuals(false);
  if (result.error && result.error.code === "ENOENT" && process.platform === "win32") result = runLuals(true);
  if (result.error) {
    console.error(`could not run ${bin}: ${result.error.message}`);
    return 2;
  }

  const problems = parseDiagnostics(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  const blocking = problems.filter(isBlocking);
  for (const p of problems) {
    const tag = isBlocking(p) ? "BLOCKING" : "note";
    console.log(`${tag} ${p.file}:${p.line} [${p.code}] ${p.message}`);
  }
  await fsp.rm(tmp, { recursive: true, force: true });

  if (blocking.length > 0) {
    console.error(`\nLuaLS check failed: ${blocking.length} blocking diagnostics in ${workspace}`);
    return 1;
  }
  console.log(`LuaLS check passed for ${workspace} (${problems.length} non-blocking diagnostics)`);
  return 0;
}

// Run only when executed directly (realpath: npm bins are symlinks on Unix).
const invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invoked === realpathSync(fileURLToPath(import.meta.url))) process.exit(await main(process.argv.slice(2)));
