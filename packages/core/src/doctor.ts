// rs3dev doctor: one place that says what the environment looks like and what
// is missing. Every first-run failure (client folder not found, LuaLS not on
// PATH, .luarc.json pointing at a moved stubs folder, a stale docs cache)
// otherwise surfaces from a different command with a different message.

import * as path from "node:path";
import { promises as fsp } from "node:fs";
import { spawnSync } from "node:child_process";
import { cacheDir, defaultClientRoots, findDevPluginsRoot } from "./paths.js";
import { resolveStubsDir, stubsIndexPath, type StubsResolveOptions } from "./luarc.js";
import { isDirectory, listFilesRecursive, pathExists, readUtf8 } from "./fs.js";

export type DoctorStatus = "ok" | "warning" | "missing";

export interface DoctorRow {
  /** Stable key for scripts: node, dev_plugins, stubs, luals, luarc, cache. */
  item: string;
  status: DoctorStatus;
  /** What was found, for example a path, a version or a count. */
  value: string;
  /** How to fix it when the status is not ok. */
  hint?: string;
}

export interface DoctorReport {
  rows: DoctorRow[];
  /** False when any row is missing. */
  ok: boolean;
}

export interface DoctorOptions extends StubsResolveOptions {
  /** Plugin folder to inspect (.luarc.json). Optional. */
  pluginDir?: string;
  /** LuaLS binary; defaults to LUA_LANGUAGE_SERVER or lua-language-server on PATH. */
  luaLanguageServer?: string;
  /** Minimum Node major from the engines field. Default 22. */
  minNodeMajor?: number;
}

const DEFAULT_MIN_NODE = 22;

function nodeRow(minMajor: number): DoctorRow {
  const major = Number(process.versions.node.split(".")[0]);
  const ok = major >= minMajor;
  return {
    item: "node",
    status: ok ? "ok" : "missing",
    value: `v${process.versions.node}`,
    hint: ok ? undefined : `Node ${minMajor} or later is required (engines field); install a current LTS from https://nodejs.org/`,
  };
}

async function devPluginsRow(options: DoctorOptions): Promise<DoctorRow> {
  const env = options.env ?? process.env;
  const candidates = defaultClientRoots(env);
  try {
    const found = await findDevPluginsRoot({ env });
    const exists = await isDirectory(found.root);
    return {
      item: "dev_plugins",
      status: exists ? "ok" : "warning",
      value: `${found.root} (${found.source})`,
      hint: exists ? undefined : "the folder does not exist yet; the client creates it, or rs3dev sync will when it is detected beside the client's *.jcache files",
    };
  } catch (error) {
    return {
      item: "dev_plugins",
      status: "missing",
      value: `not found; checked ${candidates.join(", ")}`,
      hint: `${(error as Error).message.split(". ").slice(-1)[0]} The folder sits inside the RuneScape-BETA client install next to its *.jcache files.`,
    };
  }
}

async function stubsRow(options: DoctorOptions): Promise<DoctorRow> {
  const env = options.env ?? process.env;
  const source = options.stubsDir ? "--stubs" : env.RS3_STUBS_DIR ? "RS3_STUBS_DIR" : "installed package";
  try {
    const dir = await resolveStubsDir(options);
    if (!(await isDirectory(dir))) {
      return { item: "stubs", status: "missing", value: `${dir} (${source})`, hint: "the stubs folder does not exist; install @tmhs/rs3-luals-stubs, fix RS3_STUBS_DIR, or run npm run stubs:generate in the toolkit checkout" };
    }
    let modules = "";
    try {
      const index = JSON.parse(await readUtf8(await stubsIndexPath(options))) as { modules?: unknown[]; symbols?: unknown[] };
      modules = `, ${index.modules?.length ?? 0} modules, ${index.symbols?.length ?? 0} symbols`;
    } catch {
      modules = ", index.json not readable";
    }
    return { item: "stubs", status: "ok", value: `${dir} (${source}${modules})` };
  } catch (error) {
    return { item: "stubs", status: "missing", value: `not found (${source})`, hint: (error as Error).message };
  }
}

function lualsRow(options: DoctorOptions): DoctorRow {
  const env = options.env ?? process.env;
  const bin = options.luaLanguageServer ?? env.LUA_LANGUAGE_SERVER ?? "lua-language-server";
  let result = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 15000 });
  // .cmd shims on Windows need a shell; pass one quoted command string so Node
  // does not warn about unescaped arguments (DEP0190).
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT" && process.platform === "win32") {
    result = spawnSync(`"${bin}" --version`, { encoding: "utf8", shell: true, timeout: 15000 });
  }
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split(/\r?\n/)[0] ?? "";
  if (result.error || result.status !== 0) {
    return {
      item: "luals",
      status: "missing",
      value: `${bin} not runnable${result.error ? ` (${(result.error as NodeJS.ErrnoException).code ?? result.error.message})` : ""}`,
      hint: "install lua-language-server (https://github.com/LuaLS/lua-language-server/releases) and put it on PATH or set LUA_LANGUAGE_SERVER; the editor extension works without it, the command line check does not",
    };
  }
  return { item: "luals", status: "ok", value: `${bin} (${output || "version unknown"})` };
}

async function luarcRow(pluginDir: string): Promise<DoctorRow> {
  const file = path.join(path.resolve(pluginDir), ".luarc.json");
  if (!(await pathExists(file))) {
    return { item: "luarc", status: "missing", value: `${file} not found`, hint: "run rs3dev init on a new folder, or copy packages/luals-stubs/luarc.template.json and set workspace.library" };
  }
  try {
    const luarc = JSON.parse(await readUtf8(file)) as { "workspace.library"?: string[] };
    const libraries = luarc["workspace.library"] ?? [];
    const resolved = await Promise.all(
      libraries.map(async (lib) => {
        const abs = path.resolve(path.dirname(file), lib);
        return { lib, abs, ok: await isDirectory(abs) };
      }),
    );
    const broken = resolved.filter((r) => !r.ok);
    if (libraries.length === 0) return { item: "luarc", status: "warning", value: `${file} has no workspace.library`, hint: "add the stubs folder to workspace.library so LuaLS can see the Client API" };
    if (broken.length > 0) return { item: "luarc", status: "missing", value: `${file}: ${broken.map((b) => `${b.lib} -> ${b.abs}`).join("; ")} does not exist`, hint: "the stubs folder moved; rerun rs3dev init --force or edit workspace.library (rs3dev doctor shows where the stubs are)" };
    return { item: "luarc", status: "ok", value: `${file} -> ${resolved.map((r) => r.abs).join(", ")}` };
  } catch (error) {
    return { item: "luarc", status: "missing", value: `${file} is not valid JSON`, hint: (error as Error).message };
  }
}

async function cacheRow(env: NodeJS.ProcessEnv): Promise<DoctorRow> {
  const dir = path.join(cacheDir(env), "docs");
  if (!(await isDirectory(dir))) return { item: "cache", status: "ok", value: `${dir} (empty; pages are fetched on first use)` };
  const files = await listFilesRecursive(dir);
  let bytes = 0;
  let oldest: Date | undefined;
  let newest: Date | undefined;
  for (const rel of files) {
    const stat = await fsp.stat(path.join(dir, ...rel.split("/")));
    bytes += stat.size;
    if (!oldest || stat.mtime < oldest) oldest = stat.mtime;
    if (!newest || stat.mtime > newest) newest = stat.mtime;
  }
  const pages = files.filter((f) => f.endsWith(".html")).length;
  const span = oldest && newest ? `, oldest ${oldest.toISOString().slice(0, 10)}, newest ${newest.toISOString().slice(0, 10)}` : "";
  return { item: "cache", status: "ok", value: `${dir} (${pages} pages, ${(bytes / 1024).toFixed(0)} KB${span})`, hint: pages > 0 ? "rs3dev cache clear removes it" : undefined };
}

/** Inspect the environment and return one row per check. */
export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  const rows: DoctorRow[] = [nodeRow(options.minNodeMajor ?? DEFAULT_MIN_NODE), await devPluginsRow(options), await stubsRow(options), lualsRow(options)];
  if (options.pluginDir) rows.push(await luarcRow(options.pluginDir));
  rows.push(await cacheRow(env));
  return { rows, ok: rows.every((r) => r.status !== "missing") };
}

/** Plain-text rendering of a report, one line per row plus hints. */
export function formatDoctorReport(report: DoctorReport): string[] {
  const width = Math.max(...report.rows.map((r) => r.item.length));
  const lines: string[] = [];
  for (const row of report.rows) {
    const tag = row.status === "ok" ? "ok     " : row.status === "warning" ? "warning" : "missing";
    lines.push(`${tag}  ${row.item.padEnd(width)}  ${row.value}`);
    if (row.hint && row.status !== "ok") lines.push(`${" ".repeat(9 + width + 2)}${row.hint}`);
  }
  lines.push(report.ok ? "doctor: everything needed is present" : "doctor: something is missing; see the hints above");
  return lines;
}
