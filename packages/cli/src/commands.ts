// Command implementations for rs3dev. Each returns the process exit code so the
// functions can be tested without spawning a process.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
  adoptPlugin,
  cacheDir,
  checkStubsStatus,
  DocsClient,
  runDoctor as doctorReport,
  type Finding,
  formatDoctorReport,
  formatFindings,
  formatFindingsGithub,
  formatTestReport,
  listFilesRecursive,
  loadProjectConfig,
  type Permission,
  packagePlugin,
  preflightPlugin,
  runPluginTests,
  type ScaffoldTemplate,
  scaffoldPlugin,
  summarise,
  syncPlugin,
  toSarif,
  validatePluginDir,
  verifyArchive,
  watchPlugin,
  writePluginLuarc,
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

export type ReportFormat = "text" | "json" | "github" | "sarif";

const cliVersion: string = (() => {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

function parseFormat(value: string | undefined, options: OutputOptions): ReportFormat {
  if (value && value !== "text") {
    if (value === "json" || value === "github" || value === "sarif") return value;
    throw new Error(`unknown --format "${value}"; use text, json, github or sarif`);
  }
  return options.json ? "json" : "text";
}

interface ReportOptions {
  strict?: boolean;
  format?: ReportFormat;
  suppressed?: Finding[];
  configFile?: string;
}

function reportFindings(findings: Finding[], label: string, options: OutputOptions, report: ReportOptions = {}): number {
  const summary = summarise(findings);
  const strict = Boolean(report.strict);
  const format = report.format ?? (options.json ? "json" : "text");
  if (format === "json") {
    out(options, JSON.stringify({ command: label, summary, findings, suppressed: report.suppressed ?? [], configFile: report.configFile, strict }, null, 2));
  } else if (format === "sarif") {
    out(options, JSON.stringify(toSarif(findings, { name: "rs3dev", version: cliVersion, command: label }), null, 2));
  } else if (format === "github") {
    for (const line of formatFindingsGithub(findings)) out(options, line);
    out(options, `${label}: ${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.infos} note(s)`);
  } else {
    for (const line of formatFindings(findings)) out(options, line);
    const dropped = report.suppressed?.length ? `, ${report.suppressed.length} suppressed` : "";
    out(
      options,
      `${label}: ${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.infos} note(s)${dropped}${strict && summary.warnings > 0 ? " (strict: warnings fail)" : ""}`,
    );
  }
  if (summary.errors > 0) return 1;
  return strict && summary.warnings > 0 ? 1 : 0;
}

/** Parse repeated --url name=https://host/ flags into the manifest urls map. */
export function parseUrlFlags(values: string[] | undefined): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const value of values ?? []) {
    const eq = value.indexOf("=");
    const name = eq === -1 ? "" : value.slice(0, eq).trim();
    const url = eq === -1 ? value.trim() : value.slice(eq + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`--url expects name=https://host/ (got "${value}"); the name is used as Plugin.urls.<name> in Lua`);
    }
    if (!/^https?:\/\/\S+$/i.test(url)) {
      throw new Error(`--url ${name}: "${url}" is not an http or https URL`);
    }
    urls[name] = url;
  }
  return urls;
}

export async function runInit(
  name: string,
  opts: {
    permissions?: string;
    requiredPermissions?: string;
    prettyui?: boolean;
    email?: string;
    url?: string[];
    agentFiles?: boolean;
    stubs?: string;
    force?: boolean;
    cwd?: string;
    template?: string;
    editorFiles?: boolean;
  },
  options: OutputOptions,
): Promise<number> {
  try {
    const result = await scaffoldPlugin({
      dir: path.resolve(opts.cwd ?? process.cwd(), name),
      permissions: splitList(opts.permissions) as Permission[],
      requiredPermissions: splitList(opts.requiredPermissions) as Permission[],
      prettyUi: Boolean(opts.prettyui),
      template: opts.template as ScaffoldTemplate | undefined,
      editorFiles: opts.editorFiles ?? true,
      contactEmail: opts.email,
      urls: parseUrlFlags(opts.url),
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

export async function runTest(target: string, opts: { lua?: string; stubs?: string }, options: OutputOptions): Promise<number> {
  try {
    const result = await runPluginTests(path.resolve(target), { lua: opts.lua, stubsDir: opts.stubs, resolveFrom: import.meta.url });
    if (options.json) {
      out(options, JSON.stringify({ command: "test", ...result }, null, 2));
    } else {
      for (const line of formatTestReport(result)) out(options, line);
    }
    return result.failed === 0 && result.tests.length > 0 ? 0 : 1;
  } catch (error) {
    err(options, (error as Error).message);
    return 1;
  }
}

export async function runValidate(target: string, opts: { strict?: boolean; format?: string; ignore?: string }, options: OutputOptions): Promise<number> {
  try {
    const format = parseFormat(opts.format, options);
    const ignore = new Set(splitList(opts.ignore));
    const { findings } = await validatePluginDir(path.resolve(target));
    const kept = findings.filter((f) => !ignore.has(f.code));
    const suppressed = findings.filter((f) => ignore.has(f.code));
    return reportFindings(kept, "validate", options, { strict: opts.strict, format, suppressed });
  } catch (error) {
    err(options, (error as Error).message);
    return 1;
  }
}

export async function runPreflight(
  target: string,
  opts: { maxLineLength?: string; strict?: boolean; format?: string; ignore?: string; config?: boolean },
  options: OutputOptions,
): Promise<number> {
  try {
    const format = parseFormat(opts.format, options);
    const result = await preflightPlugin(path.resolve(target), {
      maxLineLength: opts.maxLineLength !== undefined ? Number(opts.maxLineLength) : undefined,
      ignore: splitList(opts.ignore),
      config: opts.config ?? true,
    });
    return reportFindings(result.findings, "preflight", options, { strict: opts.strict, format, suppressed: result.suppressed, configFile: result.configFile });
  } catch (error) {
    err(options, (error as Error).message);
    return 1;
  }
}

export async function runSync(target: string, opts: { root?: string; prune?: boolean; createRoot?: boolean }, options: OutputOptions): Promise<number> {
  try {
    // rs3dev.json supplies the root and prune default; flags win.
    const { config } = await loadProjectConfig(path.resolve(target));
    const root = opts.root ?? (config.sync?.root ? path.resolve(path.resolve(target), config.sync.root) : undefined);
    const result = await syncPlugin(path.resolve(target), {
      override: root,
      prune: opts.prune ?? config.sync?.prune ?? true,
      createRoot: opts.createRoot ?? false,
    });
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

export async function runWatch(
  target: string,
  opts: { root?: string; debounce?: string; createRoot?: boolean; prune?: boolean },
  options: OutputOptions,
): Promise<number> {
  const source = path.resolve(target);
  const watcher = watchPlugin(source, {
    override: opts.root,
    createRoot: opts.createRoot ?? false,
    prune: opts.prune ?? true,
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

export async function runDoctor(target: string | undefined, opts: { stubs?: string }, options: OutputOptions): Promise<number> {
  const report = await doctorReport({ pluginDir: target ? path.resolve(target) : undefined, stubsDir: opts.stubs, resolveFrom: import.meta.url });
  if (options.json) {
    out(options, JSON.stringify({ command: "doctor", ...report }, null, 2));
  } else {
    for (const line of formatDoctorReport(report)) out(options, line);
  }
  return report.ok ? 0 : 1;
}

function describeLuarc(result: { file: string; library: string; resolved: string; source: string; vendoredFiles?: number }): string[] {
  const lines = [`Wrote ${result.file}`, `  workspace.library: ${result.library} (${result.source}; resolves to ${result.resolved})`];
  if (result.vendoredFiles !== undefined)
    lines.push(`  copied ${result.vendoredFiles} stub files into the plugin; rerun rs3dev luarc --vendor after updating the stubs`);
  else lines.push("  this path is specific to this machine; use --vendor to copy the stubs into the plugin folder when the plugin is shared");
  return lines;
}

export async function runAdopt(target: string, opts: { stubs?: string; vendor?: boolean; agentFiles?: boolean }, options: OutputOptions): Promise<number> {
  try {
    const result = await adoptPlugin(path.resolve(target), {
      stubsDir: opts.stubs,
      vendor: Boolean(opts.vendor),
      agentFiles: opts.agentFiles ?? true,
      resolveFrom: import.meta.url,
    });
    if (options.json) {
      out(options, JSON.stringify({ command: "adopt", ...result }, null, 2));
    } else {
      out(options, `Adopted ${result.dir}`);
      for (const line of describeLuarc(result.luarc)) out(options, line);
      if (result.files.length > 0) {
        out(options, "Agent files added (existing files were kept):");
        for (const f of result.files) out(options, `  ${f}`);
      }
      out(options, "Next: rs3dev validate . and rs3dev preflight .");
    }
    return 0;
  } catch (error) {
    err(options, (error as Error).message);
    return 1;
  }
}

export async function runLuarc(target: string, opts: { stubs?: string; vendor?: boolean }, options: OutputOptions): Promise<number> {
  try {
    const result = await writePluginLuarc(path.resolve(target), { stubsDir: opts.stubs, vendor: Boolean(opts.vendor), resolveFrom: import.meta.url });
    if (options.json) out(options, JSON.stringify({ command: "luarc", ...result }, null, 2));
    else for (const line of describeLuarc(result)) out(options, line);
    return 0;
  } catch (error) {
    err(options, (error as Error).message);
    return 1;
  }
}

export async function runStubs(action: string, opts: { stubs?: string; fetchImpl?: typeof fetch }, options: OutputOptions): Promise<number> {
  if (action !== "status") {
    err(options, `unknown stubs action "${action}"; use "status"`);
    return 1;
  }
  try {
    const status = await checkStubsStatus({ stubsDir: opts.stubs, resolveFrom: import.meta.url, fetchImpl: opts.fetchImpl });
    if (options.json) {
      out(options, JSON.stringify({ command: "stubs", ...status }, null, 2));
    } else {
      out(options, `stubs: ${status.modules} modules${status.stubsVersion ? `, generator ${status.stubsVersion}` : ""} (${status.indexFile})`);
      out(options, `${status.status}: ${status.message}`);
    }
    return status.status === "changed" ? 2 : status.status === "offline" ? 1 : 0;
  } catch (error) {
    err(options, (error as Error).message);
    return 1;
  }
}

export async function runCache(action: string, options: OutputOptions): Promise<number> {
  const dir = path.join(cacheDir(), "docs");
  if (action === "path") {
    out(options, options.json ? JSON.stringify({ command: "cache", path: dir }) : dir);
    return 0;
  }
  if (action === "clear") {
    let removed = 0;
    try {
      removed = (await listFilesRecursive(dir)).length;
    } catch {
      removed = 0;
    }
    await new DocsClient().clearCache();
    out(options, options.json ? JSON.stringify({ command: "cache", path: dir, removed }) : `Removed ${removed} cached file(s) from ${dir}`);
    return 0;
  }
  err(options, `unknown cache action "${action}"; use "path" or "clear"`);
  return 1;
}

export async function runPackage(
  target: string,
  opts: { out?: string; overwrite?: boolean; allowPlaceholderEmail?: boolean; list?: boolean; maxSize?: string; verify?: string },
  options: OutputOptions,
): Promise<number> {
  if (opts.verify) {
    try {
      const result = await verifyArchive(opts.verify);
      if (options.json) {
        out(options, JSON.stringify({ command: "verify", ...result, summary: summarise(result.findings) }, null, 2));
      } else {
        out(options, `Archive ${result.archive} (${result.bytes} bytes, ${result.entries.length} entries)`);
        if (opts.list) for (const e of result.entries) out(options, `  ${String(e.bytes).padStart(9)}  ${e.path}`);
        for (const line of formatFindings(result.findings)) out(options, line);
        const s = summarise(result.findings);
        out(options, `verify: ${s.errors} error(s), ${s.warnings} warning(s), ${s.infos} note(s)`);
      }
      return result.findings.some((f) => f.level === "error") ? 1 : 0;
    } catch (error) {
      err(options, (error as Error).message);
      return 1;
    }
  }
  try {
    const pre = await preflightPlugin(path.resolve(target));
    const errors = pre.findings.filter((f) => f.level === "error");
    if (errors.length > 0) {
      err(options, "preflight found errors; fix them before packaging:");
      for (const line of formatFindings(errors)) err(options, line);
      return 1;
    }
    const { config } = await loadProjectConfig(path.resolve(target));
    const result = await packagePlugin(path.resolve(target), {
      outFile: opts.out,
      outDir: config.package?.outDir ? path.resolve(path.resolve(target), config.package.outDir) : undefined,
      overwrite: Boolean(opts.overwrite),
      allowPlaceholderEmail: Boolean(opts.allowPlaceholderEmail),
      maxBytes: opts.maxSize !== undefined ? Number(opts.maxSize) * 1024 * 1024 : undefined,
    });
    if (options.json) {
      out(options, JSON.stringify(result, null, 2));
    } else {
      out(options, `Wrote ${result.outFile} (${result.files.length} files, ${result.bytes} bytes compressed, ${result.contentBytes} bytes of content)`);
      const shown = opts.list ? result.entries : result.entries.slice(0, 5);
      out(options, opts.list ? "Entries:" : "Largest entries:");
      for (const e of shown) out(options, `  ${String(e.bytes).padStart(9)}  ${e.path}`);
      for (const w of result.warnings) err(options, `warning: ${w}`);
      out(options, "");
      out(options, "Before uploading:");
      for (const line of result.checklist) out(options, `  ${line}`);
      out(options, result.reminder);
    }
    return 0;
  } catch (error) {
    err(options, (error as Error).message);
    return 1;
  }
}
