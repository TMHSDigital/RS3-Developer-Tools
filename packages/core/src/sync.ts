// Copy a plugin folder into the client's dev_plugins root. Copies, never
// junctions: the client reads from its own folder and a junction would let a
// stray delete reach the source tree.

import * as path from "node:path";
import { promises as fsp } from "node:fs";
import { findDevPluginsRoot, type DevPluginsRootOptions } from "./paths.js";
import { isInside, listFilesRecursive, pathExists } from "./fs.js";
import { isDevArtifact } from "./manifest.js";

export interface SyncOptions extends DevPluginsRootOptions {
  /** Delete files in the destination that no longer exist in the source. Default true. */
  prune?: boolean;
  /** Number of attempts when the client holds a lock on a file. Default 6. */
  retries?: number;
  /** Base delay between retries in milliseconds. Default 250. */
  retryDelayMs?: number;
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

/** Copy a plugin folder into dev_plugins and return the console command to reload it. */
export async function syncPlugin(pluginDir: string, options: SyncOptions = {}): Promise<SyncResult> {
  const source = path.resolve(pluginDir);
  if (!(await pathExists(path.join(source, "plugin.json")))) {
    throw new Error(`${source} does not contain a plugin.json; run rs3dev validate first`);
  }
  const { root, source: rootSource } = await findDevPluginsRoot(options);
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

  await fsp.mkdir(destination, { recursive: true });
  const files = (await listFilesRecursive(source)).filter((rel) => !isDevArtifact(rel));
  const copied: string[] = [];
  for (const rel of files) {
    const from = path.join(source, ...rel.split("/"));
    const to = path.join(destination, ...rel.split("/"));
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await withRetry(() => fsp.copyFile(from, to), retries, delay, to);
    copied.push(rel);
  }

  const removed: string[] = [];
  if (options.prune ?? true) {
    const existing = await listFilesRecursive(destination);
    const keep = new Set(files);
    for (const rel of existing) {
      if (keep.has(rel)) continue;
      await withRetry(() => fsp.rm(path.join(destination, ...rel.split("/")), { force: true }), retries, delay, rel);
      removed.push(rel);
    }
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
  };
}
