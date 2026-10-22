// Re-sync a plugin folder whenever a file inside it changes, debounced so a
// burst of saves produces a single copy.

import * as path from "node:path";
import chokidar from "chokidar";
import { syncPlugin, type SyncOptions, type SyncResult } from "./sync.js";
import { loadArtifactFilterSync } from "./ignore.js";

export interface WatchOptions extends SyncOptions {
  /** Quiet period after the last change before syncing. Default 300 ms. */
  debounceMs?: number;
  onSync?: (result: SyncResult) => void;
  onError?: (error: Error) => void;
  onChange?: (file: string) => void;
}

export interface Watcher {
  close(): Promise<void>;
  /** Resolves after the first sync completes. */
  ready: Promise<SyncResult>;
}

export function watchPlugin(pluginDir: string, options: WatchOptions = {}): Watcher {
  const source = path.resolve(pluginDir);
  const debounceMs = options.debounceMs ?? 300;
  let timer: NodeJS.Timeout | undefined;

  const runSync = async (): Promise<SyncResult> => {
    const result = await syncPlugin(source, options);
    options.onSync?.(result);
    return result;
  };

  // Every sync is chained onto the previous one, starting with the initial
  // copy, so a save during the first copy never runs two syncs over the same
  // destination at once.
  const ready = runSync();
  let running: Promise<void> = ready.then(
    () => undefined,
    () => undefined,
  );

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      running = running.then(() => runSync().then(() => undefined, (error: Error) => options.onError?.(error)));
    }, debounceMs);
  };

  // Ignore exactly what sync and package exclude (dotfiles, node_modules,
  // dist, tests, zips, OS and editor junk, .rs3ignore), so a packaged archive
  // or an editor swap file never triggers a re-sync.
  const excluded = loadArtifactFilterSync(source);
  const watcher = chokidar.watch(source, {
    ignoreInitial: true,
    ignored: (file: string) => {
      const rel = path.relative(source, file);
      if (rel === "") return false;
      return excluded(rel.split(path.sep).join("/"));
    },
  });
  watcher.on("all", (_event: string, file: string) => {
    options.onChange?.(path.relative(source, file));
    schedule();
  });

  return {
    ready,
    async close() {
      if (timer) clearTimeout(timer);
      await watcher.close();
      await running;
    },
  };
}
