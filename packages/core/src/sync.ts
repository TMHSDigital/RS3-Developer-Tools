// Copy a plugin folder into the client's dev_plugins root. Copies, never
// junctions: the client reads from its own folder and a junction would let a
// stray delete reach the source tree.

import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { isDirectory, isInside, listFilesRecursive, pathExists } from "./fs.js";
import { loadArtifactFilter } from "./ignore.js";
import { type DevPluginsRootOptions, findDevPluginsRoot } from "./paths.js";

export interface SyncOptions extends DevPluginsRootOptions {
  /** Delete files in the destination that no longer exist in the source. Default true. */
  prune?: boolean;
  /** Number of attempts when the client holds a lock on a file. Default 6. */
  retries?: number;
  /** Base delay between retries in milliseconds. Default 250. */
  retryDelayMs?: number;
  /** Resolve and check everything, list what would be copied and removed, but write nothing. */
  dryRun?: boolean;
}

export interface SyncResult {
  source: string;
  destination: string;
  root: string;
  rootSource: "override" | "env" | "detected";
  pluginName: string;
  copied: string[];
  removed: string[];
  /** Console command to reload the plugin in the client. */
  consoleCommand: string;
  /** True when nothing was written; copied and removed then describe what a real sync would do. */
  dryRun: boolean;
}

const LOCK_CODES = new Set(["EBUSY", "EPERM", "EACCES", "ETXTBSY"]);

async function withRetry<T>(action: () => Promise<T>, retries: number, delayMs: number, what: string): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await action();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      attempt++;
      if (!LOCK_CODES.has(code) || attempt > retries) {
        if (LOCK_CODES.has(code)) {
          throw new Error(
            `${what} is locked by another process (${code}) after ${retries} attempts. ` +
              "Disable the plugin in the client console first (poff <name>), then sync again.",
          );
        }
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}

/** realpath when the path exists (so a symlinked folder cannot alias another), else the resolved path. */
async function realOrResolved(target: string): Promise<string> {
  const resolved = path.resolve(target);
  try {
    return await fsp.realpath(resolved);
  } catch {
    return resolved;
  }
}

/** Copy a plugin folder into dev_plugins and return the console command to reload it. */
export async function syncPlugin(pluginDir: string, options: SyncOptions = {}): Promise<SyncResult> {
  const source = await realOrResolved(pluginDir);
  if (!(await pathExists(path.join(source, "plugin.json")))) {
    throw new Error(`${source} does not contain a plugin.json; run rs3dev validate first`);
  }
  const found = await findDevPluginsRoot(options);
  const root = await realOrResolved(found.root);
  const rootSource = found.source;
  const pluginName = path.basename(source);
  const destination = path.join(root, pluginName);
  if (!isInside(root, destination) || path.resolve(destination) === path.resolve(root)) {
    throw new Error(`refusing to sync to ${destination}: outside the dev_plugins root ${root}`);
  }
  if (isInside(destination, source) || isInside(source, destination)) {
    throw new Error("the plugin folder and the dev_plugins destination overlap; sync from a separate working copy");
  }
  const retries = options.retries ?? 6;
  const delay = options.retryDelayMs ?? 250;

  // The root itself is never created here: an explicit root was checked by
  // findDevPluginsRoot (or created on request), and a detected root sits
  // beside the client's own files. Only <root>/<plugin> is created.
  if (!(await isDirectory(root))) {
    if (rootSource === "detected" || options.createRoot) {
      await fsp.mkdir(root, { recursive: true });
    } else {
      throw new Error(`dev_plugins root ${root} does not exist; pass --create-root to create it`);
    }
  }
  // A non-empty destination must already hold a plugin copy. Pruning deletes
  // everything the source lacks, so syncing "projects" into ~/Documents must
  // never be able to empty an unrelated folder of the same name.
  if (await isDirectory(destination)) {
    const entries = await fsp.readdir(destination);
    if (entries.length > 0 && !(await pathExists(path.join(destination, "plugin.json")))) {
      throw new Error(
        `refusing to sync into ${destination}: the folder is not empty and holds no plugin.json, so it is not a copy of this plugin. ` +
          "Remove it or point --root at the client's dev_plugins folder.",
      );
    }
  }
  const dryRun = options.dryRun ?? false;
  const excluded = await loadArtifactFilter(source);
  const files = (await listFilesRecursive(source)).filter((rel) => !excluded(rel));
  const removed: string[] = [];
  if (options.prune ?? true) {
    const existing = (await isDirectory(destination)) ? await listFilesRecursive(destination) : [];
    const keep = new Set(files);
    for (const rel of existing) if (!keep.has(rel)) removed.push(rel);
  }
  if (dryRun) {
    return { source, destination, root, rootSource, pluginName, copied: files, removed, consoleCommand: `prl ${pluginName}`, dryRun: true };
  }

  await fsp.mkdir(destination, { recursive: true });
  const copied: string[] = [];
  for (const rel of files) {
    const from = path.join(source, ...rel.split("/"));
    const to = path.join(destination, ...rel.split("/"));
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await withRetry(() => fsp.copyFile(from, to), retries, delay, to);
    copied.push(rel);
  }
  for (const rel of removed) {
    await withRetry(() => fsp.rm(path.join(destination, ...rel.split("/")), { force: true }), retries, delay, rel);
  }

  return {
    source,
    destination,
    root,
    rootSource,
    pluginName,
    copied,
    removed,
    consoleCommand: `prl ${pluginName}`,
    dryRun: false,
  };
}
