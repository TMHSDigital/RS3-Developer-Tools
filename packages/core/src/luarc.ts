// LuaLS configuration for plugin workspaces: locate the generated stubs and
// write a .luarc.json that points at them.
//
// Resolution order for the stubs folder:
//   1. an explicit stubsDir argument (rs3dev init --stubs)
//   2. the RS3_STUBS_DIR environment variable
//   3. require.resolve("@tmhs/rs3-luals-stubs/package.json") from the caller
//      (the installed CLI) or, failing that, from this package
//   4. the monorepo layout (packages/luals-stubs next to packages/core)
// The path written to .luarc.json is relative to the plugin folder whenever the
// two share a drive, so a plugin folder can be moved or committed without
// carrying a machine-specific absolute path.

import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { pathExists, toPosix, writeUtf8NoBom } from "./fs.js";

const localRequire = createRequire(import.meta.url);

export interface StubsResolveOptions {
  /** Explicit folder; wins over everything. */
  stubsDir?: string;
  env?: NodeJS.ProcessEnv;
  /** import.meta.url of the caller so resolution starts at the installed CLI. */
  resolveFrom?: string;
}

/**
 * Root folder of @tmhs/rs3-luals-stubs (holds stubs/, index.json, unresolved.md).
 */
export async function stubsPackageDir(options: StubsResolveOptions = {}): Promise<string> {
  const requires = [localRequire];
  if (options.resolveFrom) requires.unshift(createRequire(options.resolveFrom));
  for (const req of requires) {
    try {
      const dir = path.dirname(req.resolve("@tmhs/rs3-luals-stubs/package.json"));
      if (await pathExists(path.join(dir, "stubs"))) return dir;
    } catch {
      // Not resolvable from here; try the next location.
    }
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const monorepo = path.resolve(here, "..", "..", "luals-stubs");
  if (await pathExists(path.join(monorepo, "stubs"))) return monorepo;
  throw new Error(
    "Could not find the RS3 LuaLS stubs. Install @tmhs/rs3-luals-stubs, set RS3_STUBS_DIR, or run npm run stubs:generate.",
  );
}

/** Absolute path to the stubs folder, honouring the explicit and environment overrides. */
export async function resolveStubsDir(options: StubsResolveOptions = {}): Promise<string> {
  if (options.stubsDir) return path.resolve(options.stubsDir);
  const env = options.env ?? process.env;
  if (env.RS3_STUBS_DIR) return path.resolve(env.RS3_STUBS_DIR);
  return path.join(await stubsPackageDir(options), "stubs");
}

/** Absolute path to the stubs folder (no overrides). Kept for callers that only need the package. */
export async function defaultStubsDir(): Promise<string> {
  return resolveStubsDir();
}

/** Absolute path to the symbol index written by the generator. */
export async function stubsIndexPath(options: StubsResolveOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  if (env.RS3_STUBS_DIR) {
    const beside = path.join(path.resolve(env.RS3_STUBS_DIR), "..", "index.json");
    if (await pathExists(beside)) return beside;
  }
  return path.join(await stubsPackageDir(options), "index.json");
}

/** The library entry written to .luarc.json: relative to the plugin folder when possible. */
export function libraryPathFor(pluginDir: string, stubsDir: string): string {
  const from = path.resolve(pluginDir);
  const to = path.resolve(stubsDir);
  const sameRoot = path.parse(from).root.toLowerCase() === path.parse(to).root.toLowerCase();
  if (!sameRoot) return toPosix(to);
  const rel = path.relative(from, to);
  return toPosix(rel === "" ? "." : rel);
}

export function luarcTemplate(libraryPath: string): Record<string, unknown> {
  return {
    $schema: "https://raw.githubusercontent.com/LuaLS/vscode-lua/master/setting/schema.json",
    "runtime.version": "Lua 5.4",
    "runtime.path": ["?.lua", "?/init.lua"],
    "runtime.pathStrict": true,
    "workspace.library": [libraryPath],
    "workspace.checkThirdParty": false,
    "diagnostics.globals": [],
    "diagnostics.severity": {
      "undefined-global": "Error",
      "undefined-field": "Error",
      "param-type-mismatch": "Error",
      "assign-type-mismatch": "Error",
      "lowercase-global": "Warning",
    },
  };
}

/** Write .luarc.json into a plugin folder. Returns the file path. */
export async function writeLuarc(pluginDir: string, options: StubsResolveOptions = {}): Promise<string> {
  const stubs = await resolveStubsDir(options);
  const file = path.join(pluginDir, ".luarc.json");
  await writeUtf8NoBom(file, JSON.stringify(luarcTemplate(libraryPathFor(pluginDir, stubs)), null, 2) + "\n");
  return file;
}
