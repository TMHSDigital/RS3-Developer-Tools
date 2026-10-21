// Command implementations for rs3dev. Each returns the process exit code so the
// functions can be tested without spawning a process.

import * as path from "node:path";
import {
  formatFindings,
  packagePlugin,
  preflightPlugin,
  scaffoldPlugin,
  summarise,
  syncPlugin,
  validatePluginDir,
  watchPlugin,
  type Finding,
  type Permission,
} from "@tmhs/rs3-devtools-core";

export interface OutputOptions {
  json: boolean;
  /** Injectable writers for tests. */
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

function out(options: OutputOptions, line: string): void {
  (options.stdout ?? ((l: string) => console.log(l)))(line);
}
function err(options: OutputOptions, line: string): void {
  (options.stderr ?? ((l: string) => console.error(l)))(line);
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function reportFindings(findings: Finding[], label: string, options: OutputOptions): number {
  const summary = summarise(findings);
  if (options.json) {
    out(options, JSON.stringify({ command: label, summary, findings }, null, 2));
  } else {
    for (const line of formatFindings(findings)) out(options, line);
    out(options, `${label}: ${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.infos} note(s)`);
  }
  return summary.errors > 0 ? 1 : 0;
}

export async function runInit(
  name: string,
  opts: { permissions?: string; requiredPermissions?: string; prettyui?: boolean; email?: string; agentFiles?: boolean; stubs?: string; force?: boolean; cwd?: string },
  options: OutputOptions,
): Promise<number> {
  try {
    const result = await scaffoldPlugin({
      dir: path.resolve(opts.cwd ?? process.cwd(), name),
      permissions: splitList(opts.permissions) as Permission[],
      requiredPermissions: splitList(opts.requiredPermissions) as Permission[],
      prettyUi: Boolean(opts.prettyui),
      contactEmail: opts.email,
      agentFiles: opts.agentFiles ?? true,
      stubsDir: opts.stubs,
      resolveFrom: import.meta.url,
      force: Boolean(opts.force),
    });
    if (options.json) {
      out(options, JSON.stringify(result, null, 2));
    } else {
      out(options, `Created ${result.pluginName} in ${result.dir}`);
      for (const f of result.files) out(options, `  ${f}`);
      out(options, "");
      out(options, "Next steps:");
      out(options, `  1. Edit plugin.json: set contactEmailAddress to a real address (legal requirement).`);
      out(options, `  2. rs3dev sync ${result.pluginName}   then in the client console: prf, pon ${result.pluginName}`);
      out(options, `  3. rs3dev watch ${result.pluginName}  to re-sync on save; reload with: prl ${result.pluginName}`);
    }
    return 0;
  } catch (error) {
    err(options, (error as Error).message);
    return 1;
  }
}

export async function runValidate(target: string, options: OutputOptions): Promise<number> {
  const { findings } = await validatePluginDir(path.resolve(target));
  return reportFindings(findings, "validate", options);
}

export async function runPreflight(target: string, opts: { maxLineLength?: string }, options: OutputOptions): Promise<number> {
  const result = await preflightPlugin(path.resolve(target), { maxLineLength: Number(opts.maxLineLength ?? 200) });
  return reportFindings(result.findings, "preflight", options);
}

export async function runSync(target: string, opts: { root?: string; prune?: boolean }, options: OutputOptions): Promise<number> {
  try {
    const result = await syncPlugin(path.resolve(target), { override: opts.root, prune: opts.prune ?? true });
    if (options.json) {
      out(options, JSON.stringify(result, null, 2));
    } else {
      out(options, `Synced ${result.copied.length} file(s) to ${result.destination} (dev_plugins root from ${result.rootSource})`);
      if (result.removed.length > 0) out(options, `Removed ${result.removed.length} stale file(s)`);
      out(options, "In the client console run:");
      out(options, `  ${result.consoleCommand}`);
      out(options, "If the plugin is not listed yet run prf, then pon " + result.pluginName);
    }
    return 0;
  } catch (error) {
    err(options, (error as Error).message);
    return 1;
  }
}

export async function runWatch(target: string, opts: { root?: string; debounce?: string }, options: OutputOptions): Promise<number> {
  const source = path.resolve(target);
  const watcher = watchPlugin(source, {
    override: opts.root,
    debounceMs: Number(opts.debounce ?? 300),
    onSync: (result) => out(options, `${new Date().toLocaleTimeString()} synced ${result.copied.length} file(s); run: ${result.consoleCommand}`),
    onError: (error) => err(options, `sync failed: ${error.message}`),
  });
  try {
    await watcher.ready;
  } catch (error) {
    err(options, (error as Error).message);
    await watcher.close();
    return 1;
  }
  out(options, `Watching ${source} for changes. Press Ctrl+C to stop.`);
  await new Promise<void>((resolve) => {
    const stop = () => {
      watcher.close().then(resolve, resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

export async function runPackage(
  target: string,
  opts: { out?: string; overwrite?: boolean; allowPlaceholderEmail?: boolean },
  options: OutputOptions,
): Promise<number> {
  try {
    const pre = await preflightPlugin(path.resolve(target));
    const errors = pre.findings.filter((f) => f.level === "error");
    if (errors.length > 0) {
      err(options, "preflight found errors; fix them before packaging:");
      for (const line of formatFindings(errors)) err(options, line);
      return 1;
    }
    const result = await packagePlugin(path.resolve(target), {
      outFile: opts.out,
      overwrite: Boolean(opts.overwrite),
      allowPlaceholderEmail: Boolean(opts.allowPlaceholderEmail),
    });
    if (options.json) {
      out(options, JSON.stringify(result, null, 2));
    } else {
      out(options, `Wrote ${result.outFile} (${result.files.length} files, ${result.bytes} bytes)`);
      out(options, result.reminder);
    }
    return 0;
  } catch (error) {
    err(options, (error as Error).message);
    return 1;
  }
}
