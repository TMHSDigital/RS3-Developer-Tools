// LuaLS configuration for plugin workspaces: locate the generated stubs and
// write a .luarc.json that points at them.

import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { pathExists, toPosix, writeUtf8NoBom } from "./fs.js";

const require = createRequire(import.meta.url);

/**
 * Root folder of @tmhs/rs3-luals-stubs (holds stubs/, index.json, unresolved.md).
 * Resolves the installed package first and falls back to the monorepo layout.
 */
export async function stubsPackageDir(): Promise<string> {
  try {
    const pkgJson = require.resolve("@tmhs/rs3-luals-stubs/package.json");
    const dir = path.dirname(pkgJson);
    if (await pathExists(path.join(dir, "stubs"))) return dir;
  } catch {
    // Not installed as a dependency; try the repository layout.
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const monorepo = path.resolve(here, "..", "..", "luals-stubs");
  if (await pathExists(path.join(monorepo, "stubs"))) return monorepo;
  throw new Error("Could not find the RS3 LuaLS stubs. Install @tmhs/rs3-luals-stubs or run npm run stubs:generate.");
}

/** Absolute path to the stubs folder. */
export async function defaultStubsDir(): Promise<string> {
  return path.join(await stubsPackageDir(), "stubs");
}

/** Absolute path to the symbol index written by the generator. */
export async function stubsIndexPath(): Promise<string> {
  return path.join(await stubsPackageDir(), "index.json");
}

export function luarcTemplate(stubsDir: string): Record<string, unknown> {
  return {
    $schema: "https://raw.githubusercontent.com/LuaLS/vscode-lua/master/setting/schema.json",
    "runtime.version": "Lua 5.4",
    "runtime.path": ["?.lua", "?/init.lua"],
    "runtime.pathStrict": true,
    "workspace.library": [toPosix(stubsDir)],
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
export async function writeLuarc(pluginDir: string, stubsDir?: string): Promise<string> {
  const stubs = stubsDir ?? (await defaultStubsDir());
  const file = path.join(pluginDir, ".luarc.json");
  await writeUtf8NoBom(file, JSON.stringify(luarcTemplate(stubs), null, 2) + "\n");
  return file;
}
