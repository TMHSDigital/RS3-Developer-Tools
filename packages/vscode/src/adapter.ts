// The part of the extension that does not touch the VS Code API, so it can be
// unit tested: parsing rs3dev --json output, turning findings into
// diagnostics, locating the plugin root, building the CLI invocation and
// merging the Cursor MCP configuration.

import * as path from "node:path";

export type FindingLevel = "error" | "warning" | "info";

export interface CliFinding {
  level: FindingLevel;
  code: string;
  message: string;
  /** Relative to the plugin folder; absent for folder-level findings. */
  file?: string;
  /** 1-based; absent when the finding is not tied to a line. */
  line?: number;
  docsUrl?: string;
}

export interface CliReport {
  command?: string;
  summary?: { errors: number; warnings: number; infos: number };
  findings?: CliFinding[];
  suppressed?: CliFinding[];
  [key: string]: unknown;
}

/** Severity as VS Code numbers them: 0 error, 1 warning, 2 information. */
export type Severity = 0 | 1 | 2;

export interface DiagnosticLike {
  /** Absolute path of the file the diagnostic belongs to. */
  file: string;
  /** 0-based line. */
  line: number;
  message: string;
  severity: Severity;
  code: string;
  docsUrl?: string;
}

/** Parse the JSON object the CLI printed, tolerating text before or after it (warnings, progress). */
export function parseReport(stdout: string): CliReport {
  const text = stdout.trim();
  try {
    return JSON.parse(text) as CliReport;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1)) as CliReport;
    }
    throw new Error(`rs3dev did not print JSON: ${text.slice(0, 200)}`);
  }
}

const SEVERITY: Record<FindingLevel, Severity> = { error: 0, warning: 1, info: 2 };

/** Findings to diagnostics. Folder-level findings land on plugin.json, line 1. */
export function toDiagnostics(findings: CliFinding[], pluginRoot: string): DiagnosticLike[] {
  return findings.map((f) => ({
    file: path.join(pluginRoot, ...(f.file ?? "plugin.json").split("/")),
    line: Math.max(0, (f.line ?? 1) - 1),
    message: f.message,
    severity: SEVERITY[f.level] ?? 2,
    code: f.code,
    ...(f.docsUrl ? { docsUrl: f.docsUrl } : {}),
  }));
}

export function groupByFile(diagnostics: DiagnosticLike[]): Map<string, DiagnosticLike[]> {
  const groups = new Map<string, DiagnosticLike[]>();
  for (const d of diagnostics) {
    const list = groups.get(d.file) ?? [];
    list.push(d);
    groups.set(d.file, list);
  }
  return groups;
}

/**
 * The plugin folder that contains `start` (a file or folder): the nearest
 * ancestor holding plugin.json. Dev artefact folders (tests, .rs3) belong to
 * the plugin above them.
 */
export async function findPluginRoot(start: string, exists: (p: string) => Promise<boolean>): Promise<string | undefined> {
  let dir = path.resolve(start);
  if (path.extname(dir) !== "" && !(await exists(path.join(dir, "plugin.json")))) dir = path.dirname(dir);
  for (;;) {
    if (await exists(path.join(dir, "plugin.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export interface CliInvocation {
  command: string;
  args: string[];
  /** True when the command is an npm shim (rs3dev.cmd, npx.cmd) that needs a shell on Windows. */
  shell: boolean;
}

/**
 * Turn the configured CLI setting into a spawnable command.
 *   "rs3dev"                         -> rs3dev <args>
 *   "npx -y @tmhs/rs3-devtools-cli"  -> npx -y @tmhs/rs3-devtools-cli <args>
 *   "C:/toolkit/packages/cli/dist/cli.js" -> node <that file> <args>
 */
export function cliInvocation(cliPath: string, args: string[], platform: NodeJS.Platform = process.platform, nodePath = "node"): CliInvocation {
  const setting = cliPath.trim() || "rs3dev";
  if (/\.(c|m)?js$/i.test(setting)) return { command: nodePath, args: [setting, ...args], shell: false };
  const parts = setting.match(/"[^"]*"|\S+/g)?.map((p) => p.replace(/^"|"$/g, "")) ?? [setting];
  const [command, ...leading] = parts;
  return { command: command ?? "rs3dev", args: [...leading, ...args], shell: platform === "win32" };
}

/** One line for a notification after validate or preflight. */
export function summaryLine(report: CliReport, command: string): string {
  const s = report.summary ?? { errors: 0, warnings: 0, infos: 0 };
  const findings = report.findings ?? [];
  if (findings.length === 0) return `${command}: no findings`;
  return `${command}: ${s.errors} error(s), ${s.warnings} warning(s), ${s.infos} note(s)`;
}

export interface TestReport {
  tests?: { file: string; name: string; ok: boolean; message?: string }[];
  passed?: number;
  failed?: number;
  files?: string[];
  engine?: string;
  output?: string[];
}

/** Lines for the output channel after rs3dev test --json. */
export function formatTestLines(report: TestReport): string[] {
  const lines: string[] = [];
  for (const t of report.tests ?? []) {
    lines.push(`${t.ok ? "ok  " : "FAIL"} ${t.file}: ${t.name}`);
    if (!t.ok && t.message) for (const l of t.message.split("\n")) lines.push(`       ${l}`);
  }
  for (const l of report.output ?? []) lines.push(`     | ${l}`);
  const passed = report.passed ?? 0;
  const failed = report.failed ?? 0;
  lines.push(`${passed} of ${passed + failed} test(s) passed in ${(report.files ?? []).length} file(s) (${report.engine ?? "?"})`);
  return lines;
}

export interface McpServerEntry {
  command: string;
  args: string[];
}

/** Merge one server into a .cursor/mcp.json document, keeping everything else. */
export function mergeMcpConfig(existingText: string | undefined, name: string, entry: McpServerEntry): string {
  let doc: { mcpServers?: Record<string, unknown>; [key: string]: unknown } = {};
  if (existingText?.trim()) {
    try {
      doc = JSON.parse(existingText) as typeof doc;
    } catch {
      throw new Error(".cursor/mcp.json is not valid JSON; fix it by hand first");
    }
  }
  doc.mcpServers = { ...(doc.mcpServers ?? {}), [name]: entry };
  return `${JSON.stringify(doc, null, 2)}\n`;
}
