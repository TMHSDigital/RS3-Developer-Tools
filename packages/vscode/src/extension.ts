// VS Code and Cursor extension: a thin layer over the rs3dev CLI. Findings
// from validate and preflight become Problems-panel diagnostics whose code
// links to the documentation; test, sync, package and doctor run in an output
// channel; watch is a status-bar toggle around a long-running rs3dev process.
// The CLI is spawned (rs3.cliPath), so the extension carries no toolkit code
// of its own and always matches the installed rs3dev.

import { type ChildProcess, spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  type CliReport,
  cliInvocation,
  type DiagnosticLike,
  findPluginRoot,
  formatTestLines,
  groupByFile,
  mergeMcpConfig,
  parseReport,
  summaryLine,
  type TestReport,
  toDiagnostics,
} from "./adapter.js";

const SEVERITIES = [vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning, vscode.DiagnosticSeverity.Information] as const;

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

let output: vscode.OutputChannel;
let diagnostics: vscode.DiagnosticCollection;
let statusBar: vscode.StatusBarItem;
let watcher: { process: ChildProcess; root: string } | undefined;

function config() {
  return vscode.workspace.getConfiguration("rs3");
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Run the CLI once and collect its output. */
function runCli(args: string[], cwd: string): Promise<CliResult> {
  const invocation = cliInvocation(config().get<string>("cliPath", "rs3dev"), args, process.platform, process.execPath);
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, { cwd, shell: invocation.shell, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) =>
      reject(new Error(`could not start ${invocation.command}: ${error.message}. Set rs3.cliPath to the rs3dev command or to packages/cli/dist/cli.js.`)),
    );
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** The plugin folder for the active editor or the workspace; asks when several plugins are open. */
async function pickPluginRoot(): Promise<string | undefined> {
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active?.scheme === "file") {
    const root = await findPluginRoot(active.fsPath, exists);
    if (root) return root;
  }
  const candidates: string[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (await exists(path.join(folder.uri.fsPath, "plugin.json"))) candidates.push(folder.uri.fsPath);
  }
  if (candidates.length === 0) {
    const found = await vscode.workspace.findFiles("**/plugin.json", "**/node_modules/**", 20);
    for (const uri of found) candidates.push(path.dirname(uri.fsPath));
  }
  if (candidates.length === 0) {
    vscode.window.showWarningMessage("RS3: no plugin.json found in the workspace. Open a plugin folder or run rs3dev init.");
    return undefined;
  }
  if (candidates.length === 1) return candidates[0];
  return vscode.window.showQuickPick(candidates.sort(), { placeHolder: "Which plugin?" });
}

function publish(root: string, items: DiagnosticLike[]): void {
  // Replace every diagnostic that belongs to this plugin, including files that are now clean.
  diagnostics.forEach((uri) => {
    if (uri.fsPath.startsWith(root)) diagnostics.delete(uri);
  });
  for (const [file, list] of groupByFile(items)) {
    const converted = list.map((d) => {
      const range = new vscode.Range(d.line, 0, d.line, Number.MAX_SAFE_INTEGER);
      const diagnostic = new vscode.Diagnostic(range, d.message, SEVERITIES[d.severity]);
      diagnostic.source = "rs3dev";
      diagnostic.code = d.docsUrl ? { value: d.code, target: vscode.Uri.parse(d.docsUrl) } : d.code;
      return diagnostic;
    });
    diagnostics.set(vscode.Uri.file(file), converted);
  }
}

/** validate plus preflight into the Problems panel. */
async function runChecks(root: string, announce: boolean): Promise<void> {
  const reports: CliReport[] = [];
  const maxLine = config().get<number>("maxLineLength", 0);
  for (const command of ["validate", "preflight"]) {
    const args = ["--json", command, root];
    if (command === "preflight" && maxLine > 0) args.push("--max-line-length", String(maxLine));
    const result = await runCli(args, root);
    try {
      reports.push(parseReport(result.stdout));
    } catch (error) {
      output.appendLine(`${command}: ${(error as Error).message}`);
      if (result.stderr) output.appendLine(result.stderr);
      vscode.window.showErrorMessage(`RS3 ${command} failed; see the RS3 Developer Tools output`);
      return;
    }
  }
  const findings = reports.flatMap((r) => r.findings ?? []);
  publish(root, toDiagnostics(findings, root));
  const summary = reports.map((r, i) => summaryLine(r, ["validate", "preflight"][i] ?? "")).join("; ");
  output.appendLine(`${new Date().toLocaleTimeString()} ${path.basename(root)}: ${summary}`);
  if (announce) {
    const errors = findings.filter((f) => f.level === "error").length;
    (errors > 0 ? vscode.window.showErrorMessage : vscode.window.showInformationMessage)(`RS3 ${summary}`);
  }
}

async function runTests(root: string): Promise<void> {
  const stubs = config().get<string>("stubsDir", "");
  const args = ["--json", "test", root, ...(stubs ? ["--stubs", stubs] : [])];
  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "RS3: running plugin tests" }, () =>
    runCli(args, root),
  );
  output.show(true);
  let report: TestReport;
  try {
    report = parseReport(result.stdout) as TestReport;
  } catch {
    output.appendLine(result.stderr || result.stdout);
    vscode.window.showErrorMessage(`RS3 test: ${(result.stderr || result.stdout).trim().split("\n")[0] ?? "failed"}`);
    return;
  }
  for (const line of formatTestLines(report)) output.appendLine(line);
  const failed = report.failed ?? 0;
  (failed > 0 ? vscode.window.showErrorMessage : vscode.window.showInformationMessage)(`RS3 test: ${report.passed ?? 0} passed, ${failed} failed`);
}

/** Text-mode commands whose output the user reads: sync, package, doctor. */
async function runAndShow(label: string, args: string[], root: string): Promise<void> {
  output.show(true);
  output.appendLine(`> rs3dev ${args.join(" ")}`);
  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `RS3: ${label}` }, () => runCli(args, root));
  if (result.stdout) output.appendLine(result.stdout.trimEnd());
  if (result.stderr) output.appendLine(result.stderr.trimEnd());
  const firstLine = (result.stdout || result.stderr).trim().split("\n")[0] ?? "";
  if (result.code === 0) vscode.window.showInformationMessage(`RS3 ${label}: ${firstLine}`);
  else vscode.window.showErrorMessage(`RS3 ${label} failed (exit ${result.code}): ${firstLine}`);
}

function rootArgs(): string[] {
  const root = config().get<string>("devPluginsRoot", "");
  return root ? ["--root", root] : [];
}

function stopWatch(): void {
  if (!watcher) return;
  watcher.process.kill();
  output.appendLine(`watch stopped for ${watcher.root}`);
  watcher = undefined;
  statusBar.text = "$(eye-closed) RS3 watch";
  statusBar.tooltip = "Start rs3dev watch (sync on save)";
}

async function toggleWatch(): Promise<void> {
  if (watcher) {
    stopWatch();
    return;
  }
  const root = await pickPluginRoot();
  if (!root) return;
  const invocation = cliInvocation(config().get<string>("cliPath", "rs3dev"), ["watch", root, ...rootArgs()], process.platform, process.execPath);
  const child = spawn(invocation.command, invocation.args, { cwd: root, shell: invocation.shell, env: process.env });
  watcher = { process: child, root };
  output.show(true);
  child.stdout?.on("data", (chunk: Buffer) => output.append(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => output.append(chunk.toString()));
  child.on("error", (error) => {
    output.appendLine(`watch could not start: ${error.message}`);
    stopWatch();
  });
  child.on("close", (code) => {
    if (watcher?.process === child) {
      output.appendLine(`watch exited with ${code}`);
      watcher = undefined;
      statusBar.text = "$(eye-closed) RS3 watch";
    }
  });
  statusBar.text = "$(sync~spin) RS3 watch";
  statusBar.tooltip = `rs3dev watch is syncing ${path.basename(root)} on every save; click to stop`;
}

async function registerMcp(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage("RS3: open a folder first");
    return;
  }
  const file = path.join(folder.uri.fsPath, ".cursor", "mcp.json");
  const choice = await vscode.window.showWarningMessage(
    `Write the rs3-plugin MCP server into ${file}? The server runs with npx -y @tmhs/rs3-plugin-mcp and reads only this workspace.`,
    { modal: true },
    "Write",
  );
  if (choice !== "Write") return;
  const existing = (await exists(file)) ? await fsp.readFile(file, "utf8") : undefined;
  const merged = mergeMcpConfig(existing, "rs3-plugin", { command: "npx", args: ["-y", "@tmhs/rs3-plugin-mcp", "--workspace", "."] });
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, merged);
  vscode.window.showInformationMessage(`RS3: MCP server registered in ${path.relative(folder.uri.fsPath, file)}; reload Cursor to pick it up`);
}

/** "Open documentation" quick fix for every rs3dev diagnostic that carries a link. */
class DocsActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(_document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const d of context.diagnostics) {
      if (d.source !== "rs3dev" || typeof d.code !== "object" || !("target" in d.code)) continue;
      const action = new vscode.CodeAction(`Open documentation for ${d.code.value}`, vscode.CodeActionKind.QuickFix);
      action.diagnostics = [d];
      action.command = { command: "vscode.open", title: "Open documentation", arguments: [d.code.target] };
      actions.push(action);
    }
    return actions;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("RS3 Developer Tools");
  diagnostics = vscode.languages.createDiagnosticCollection("rs3dev");
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBar.command = "rs3.watch";
  statusBar.text = "$(eye-closed) RS3 watch";
  statusBar.tooltip = "Start rs3dev watch (sync on save)";
  statusBar.show();

  const withRoot = (fn: (root: string) => Promise<void>) => async () => {
    const root = await pickPluginRoot();
    if (root) {
      try {
        await fn(root);
      } catch (error) {
        output.appendLine((error as Error).message);
        vscode.window.showErrorMessage(`RS3: ${(error as Error).message}`);
      }
    }
  };

  context.subscriptions.push(
    output,
    diagnostics,
    statusBar,
    vscode.commands.registerCommand(
      "rs3.validate",
      withRoot((root) => runChecks(root, true)),
    ),
    vscode.commands.registerCommand(
      "rs3.preflight",
      withRoot((root) => runChecks(root, true)),
    ),
    vscode.commands.registerCommand("rs3.test", withRoot(runTests)),
    vscode.commands.registerCommand(
      "rs3.sync",
      withRoot((root) => runAndShow("sync", ["sync", root, ...rootArgs()], root)),
    ),
    vscode.commands.registerCommand(
      "rs3.package",
      withRoot((root) => runAndShow("package", ["package", root], root)),
    ),
    vscode.commands.registerCommand(
      "rs3.doctor",
      withRoot((root) => {
        const stubs = config().get<string>("stubsDir", "");
        return runAndShow("doctor", ["doctor", root, ...(stubs ? ["--stubs", stubs] : [])], root);
      }),
    ),
    vscode.commands.registerCommand("rs3.watch", toggleWatch),
    vscode.commands.registerCommand("rs3.registerMcp", registerMcp),
    vscode.languages.registerCodeActionsProvider([{ language: "lua" }, { language: "json" }, { language: "jsonc" }], new DocsActionProvider(), {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (!config().get<boolean>("checkOnSave", true)) return;
      const file = document.uri.fsPath;
      if (!(file.endsWith(".lua") || path.basename(file) === "plugin.json")) return;
      const root = await findPluginRoot(file, exists);
      if (!root) return;
      try {
        await runChecks(root, false);
      } catch (error) {
        output.appendLine((error as Error).message);
      }
    }),
    { dispose: stopWatch },
  );
}

export function deactivate(): void {
  stopWatch();
}
