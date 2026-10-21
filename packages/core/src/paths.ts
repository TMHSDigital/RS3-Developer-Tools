// Well-known locations: the per-user cache folder and the RS3 beta client's
// dev_plugins root.

import * as os from "node:os";
import * as path from "node:path";
import { promises as fsp } from "node:fs";
import { isDirectory } from "./fs.js";

/**
 * Per-user cache directory for fetched documentation and other transient data.
 * Windows: %LOCALAPPDATA%\rs3-devtools\cache
 * Others:  $XDG_CACHE_HOME/rs3-devtools or ~/.cache/rs3-devtools
 * Override with RS3_DEVTOOLS_CACHE_DIR.
 */
export function cacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RS3_DEVTOOLS_CACHE_DIR) return path.resolve(env.RS3_DEVTOOLS_CACHE_DIR);
  if (process.platform === "win32") {
    const local = env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    return path.join(local, "rs3-devtools", "cache");
  }
  const base = env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  return path.join(base, "rs3-devtools");
}

/** Default RuneScape-BETA client folders per platform, as listed in the official tutorial. */
export function defaultClientRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = os.homedir();
  if (process.platform === "win32") {
    const programData = env.ProgramData ?? "C:\\ProgramData";
    return [path.join(programData, "Jagex", "RuneScape-BETA")];
  }
  if (process.platform === "darwin") {
    return [path.join(home, "Jagex", "RuneScape-BETA")];
  }
  return [
    path.join(home, ".local", "share", "bolt-launcher", "jagex", "RuneScape-BETA"),
    path.join(
      home,
      ".var",
      "app",
      "com.jagex.Launcher",
      "data",
      "wine",
      "drive_c",
      "users",
      os.userInfo().username,
      "AppData",
      "Local",
      "Jagex",
      "RuneScape-BETA",
    ),
  ];
}

/** True when the folder contains at least one *.jcache file, the client's cache marker. */
export async function looksLikeClientRoot(dir: string): Promise<boolean> {
  if (!(await isDirectory(dir))) return false;
  try {
    const entries = await fsp.readdir(dir);
    return entries.some((name) => name.toLowerCase().endsWith(".jcache"));
  } catch {
    return false;
  }
}

export interface DevPluginsRootOptions {
  /** Explicit override, for example from a --root flag. Wins over everything. */
  override?: string;
  env?: NodeJS.ProcessEnv;
  /** Extra client roots to scan, used by tests. */
  candidateClientRoots?: string[];
}

export interface DevPluginsRootResult {
  root: string;
  /** How the root was chosen; shown to the user so the decision is transparent. */
  source: "override" | "env" | "detected";
}

/**
 * Resolve the dev_plugins folder the client loads plugins from.
 * Order: explicit override, RS3_DEV_PLUGINS_DIR, then a scan of the default
 * client roots for a folder holding *.jcache files (dev_plugins sits beside them).
 */
export async function findDevPluginsRoot(
  options: DevPluginsRootOptions = {},
): Promise<DevPluginsRootResult> {
  const env = options.env ?? process.env;
  if (options.override) {
    return { root: path.resolve(options.override), source: "override" };
  }
  if (env.RS3_DEV_PLUGINS_DIR) {
    return { root: path.resolve(env.RS3_DEV_PLUGINS_DIR), source: "env" };
  }
  const candidates = options.candidateClientRoots ?? defaultClientRoots(env);
  for (const clientRoot of candidates) {
    if (await looksLikeClientRoot(clientRoot)) {
      return { root: path.join(clientRoot, "dev_plugins"), source: "detected" };
    }
  }
  throw new Error(
    "Could not find the RS3 beta client (no *.jcache files in: " +
      candidates.join(", ") +
      "). Set RS3_DEV_PLUGINS_DIR or pass --root <path to dev_plugins>.",
  );
}
