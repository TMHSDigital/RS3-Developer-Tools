// Adopt an existing plugin folder: write or refresh .luarc.json and copy the
// agent guidance files without touching plugin.json or main.lua.
//
// The library path in .luarc.json is only portable when the stubs live inside
// the plugin folder. A path into a global npm install or another checkout is
// machine-specific even when written relatively, so --vendor copies the stubs
// to <plugin>/.rs3/stubs (a dotfolder, excluded from sync and package) and
// points .luarc.json at ./.rs3/stubs.

import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { isDirectory, listFilesRecursive, pathExists, readUtf8, writeUtf8NoBom } from "./fs.js";
import { libraryPathFor, luarcTemplate, resolveStubsDir, type StubsResolveOptions } from "./luarc.js";
import { copyAgentFiles } from "./scaffold.js";

export const VENDORED_STUBS_DIR = path.join(".rs3", "stubs");

export type LuarcSource = "--stubs" | "RS3_STUBS_DIR" | "installed package" | "monorepo checkout" | "vendored";

export interface LuarcWriteOptions extends StubsResolveOptions {
  /** Copy the stubs into <plugin>/.rs3/stubs and reference that folder. */
  vendor?: boolean;
}

export interface LuarcWriteResult {
  file: string;
  /** workspace.library entry as written. */
  library: string;
  /** Absolute folder the entry resolves to. */
  resolved: string;
  source: LuarcSource;
  /** Number of files copied when vendoring. */
  vendoredFiles?: number;
}

/** Which resolution step produced a stubs folder, for the "why this path" line. */
function sourceOf(options: StubsResolveOptions, resolved: string): LuarcSource {
  if (options.stubsDir) return "--stubs";
  if ((options.env ?? process.env).RS3_STUBS_DIR) return "RS3_STUBS_DIR";
  return resolved.split(/[\\/]/).includes("node_modules") ? "installed package" : "monorepo checkout";
}

/** Write or refresh <pluginDir>/.luarc.json, keeping any diagnostics.globals already listed. */
export async function writePluginLuarc(pluginDir: string, options: LuarcWriteOptions = {}): Promise<LuarcWriteResult> {
  const dir = path.resolve(pluginDir);
  const file = path.join(dir, ".luarc.json");
  let globals: string[] = [];
  if (await pathExists(file)) {
    try {
      const existing = JSON.parse(await readUtf8(file)) as { "diagnostics.globals"?: unknown };
      if (Array.isArray(existing["diagnostics.globals"])) globals = existing["diagnostics.globals"].filter((g): g is string => typeof g === "string");
    } catch {
      // An unreadable file is replaced.
    }
  }
  const stubs = await resolveStubsDir(options);
  if (!(await isDirectory(stubs))) throw new Error(`stubs folder ${stubs} does not exist; install @tmhs/rs3-luals-stubs, set RS3_STUBS_DIR or pass --stubs`);

  if (options.vendor) {
    const target = path.join(dir, VENDORED_STUBS_DIR);
    await fsp.rm(target, { recursive: true, force: true });
    await fsp.mkdir(target, { recursive: true });
    const files = await listFilesRecursive(stubs);
    for (const rel of files) {
      const to = path.join(target, ...rel.split("/"));
      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.copyFile(path.join(stubs, ...rel.split("/")), to);
    }
    const library = "./" + VENDORED_STUBS_DIR.split(path.sep).join("/");
    await writeUtf8NoBom(file, JSON.stringify(luarcTemplate(library, globals), null, 2) + "\n");
    return { file, library, resolved: target, source: "vendored", vendoredFiles: files.length };
  }

  const library = libraryPathFor(dir, stubs);
  await writeUtf8NoBom(file, JSON.stringify(luarcTemplate(library, globals), null, 2) + "\n");
  return { file, library, resolved: stubs, source: sourceOf(options, stubs) };
}

export interface AdoptOptions extends LuarcWriteOptions {
  /** Copy AGENTS.md, Cursor rules and Claude Code skills (never overwriting). Default true. */
  agentFiles?: boolean;
}

export interface AdoptResult {
  dir: string;
  luarc: LuarcWriteResult;
  /** Agent files written (existing ones are kept). */
  files: string[];
}

/** Bring an existing plugin folder into the toolkit without changing its code or manifest. */
export async function adoptPlugin(pluginDir: string, options: AdoptOptions = {}): Promise<AdoptResult> {
  const dir = path.resolve(pluginDir);
  if (!(await pathExists(path.join(dir, "plugin.json")))) {
    throw new Error(`${dir} has no plugin.json; adopt works on an existing plugin folder (use rs3dev init <name> for a new one)`);
  }
  const luarc = await writePluginLuarc(dir, options);
  const files = (options.agentFiles ?? true) ? await copyAgentFiles(dir) : [];
  return { dir, luarc, files };
}

/** Workspace.library entries of a .luarc.json that do not resolve to a stubs folder (one holding _globals.lua). */
export async function staleLibraryEntries(pluginDir: string): Promise<{ entry: string; resolved: string }[]> {
  const file = path.join(path.resolve(pluginDir), ".luarc.json");
  if (!(await pathExists(file))) return [];
  let parsed: { "workspace.library"?: unknown };
  try {
    parsed = JSON.parse(await readUtf8(file)) as typeof parsed;
  } catch {
    return [];
  }
  const entries = Array.isArray(parsed["workspace.library"]) ? parsed["workspace.library"].filter((e): e is string => typeof e === "string") : [];
  const stale: { entry: string; resolved: string }[] = [];
  for (const entry of entries) {
    const resolved = path.resolve(path.dirname(file), entry);
    if (!(await pathExists(path.join(resolved, "_globals.lua")))) stale.push({ entry, resolved });
  }
  return stale;
}
