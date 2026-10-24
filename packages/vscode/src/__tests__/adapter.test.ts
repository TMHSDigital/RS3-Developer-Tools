import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { cliInvocation, findPluginRoot, formatTestLines, groupByFile, mergeMcpConfig, parseReport, summaryLine, toDiagnostics } from "../adapter.js";

// The extension is a thin layer over the rs3dev CLI; everything that can be
// tested without VS Code lives in adapter.ts.

describe("parseReport", () => {
  it("accepts plain JSON and JSON surrounded by stray output", () => {
    expect(parseReport('{"command":"validate","findings":[]}').command).toBe("validate");
    expect(parseReport('npm warn something\n{"command":"preflight","findings":[]}\n').command).toBe("preflight");
    expect(() => parseReport("not json at all")).toThrow(/did not print JSON/);
  });
});

describe("toDiagnostics", () => {
  it("maps levels, 1-based lines and folder-level findings onto plugin.json", () => {
    const root = path.resolve("plugin");
    const result = toDiagnostics(
      [
        {
          level: "error",
          code: "shutdown-missing",
          message: "no PluginShutdown",
          file: "main.lua",
          line: 12,
          docsUrl: "https://developer.runescape.com/rs/structure.html",
        },
        { level: "warning", code: "placeholder-email", message: "placeholder", file: "plugin.json" },
        { level: "info", code: "component-not-destroyed", message: "destroy it", file: "ui/window.lua", line: 1 },
        { level: "error", code: "manifest-missing", message: "no plugin.json" },
      ],
      root,
    );
    expect(result.map((d) => [path.relative(root, d.file), d.line, d.severity, d.code])).toEqual([
      ["main.lua", 11, 0, "shutdown-missing"],
      ["plugin.json", 0, 1, "placeholder-email"],
      [path.join("ui", "window.lua"), 0, 2, "component-not-destroyed"],
      ["plugin.json", 0, 0, "manifest-missing"],
    ]);
    expect(result[0]?.docsUrl).toBe("https://developer.runescape.com/rs/structure.html");
    expect(result[1]?.docsUrl).toBeUndefined();
    const grouped = groupByFile(result);
    expect(grouped.get(path.join(root, "plugin.json"))).toHaveLength(2);
    expect(grouped.size).toBe(3);
  });
});

describe("findPluginRoot", () => {
  it("walks up from a file or a nested folder to the folder holding plugin.json", async () => {
    const root = path.resolve("ws", "my-plugin");
    const present = new Set([path.join(root, "plugin.json")]);
    const exists = async (p: string) => present.has(p);
    expect(await findPluginRoot(path.join(root, "tests", "a_test.lua"), exists)).toBe(root);
    expect(await findPluginRoot(path.join(root, "main.lua"), exists)).toBe(root);
    expect(await findPluginRoot(root, exists)).toBe(root);
    expect(await findPluginRoot(path.resolve("ws", "other", "x.lua"), exists)).toBeUndefined();
  });
});

describe("cliInvocation", () => {
  it("runs a .js path with Node, splits a command line, and uses a shell for npm shims on Windows", () => {
    expect(cliInvocation("C:/toolkit/packages/cli/dist/cli.js", ["--json", "validate", "."], "win32", "node.exe")).toEqual({
      command: "node.exe",
      args: ["C:/toolkit/packages/cli/dist/cli.js", "--json", "validate", "."],
      shell: false,
    });
    expect(cliInvocation("npx -y @tmhs/rs3-devtools-cli", ["doctor"], "linux")).toEqual({
      command: "npx",
      args: ["-y", "@tmhs/rs3-devtools-cli", "doctor"],
      shell: false,
    });
    expect(cliInvocation("rs3dev", ["sync", "."], "win32")).toEqual({ command: "rs3dev", args: ["sync", "."], shell: true });
    expect(cliInvocation("  ", ["doctor"], "darwin").command).toBe("rs3dev");
    expect(cliInvocation('"C:/Program Files/tools/rs3dev.cmd" --verbose', ["doctor"], "win32")).toEqual({
      command: "C:/Program Files/tools/rs3dev.cmd",
      args: ["--verbose", "doctor"],
      shell: true,
    });
  });
});

describe("summaries", () => {
  it("summarise check reports and test reports", () => {
    expect(summaryLine({ findings: [] }, "validate")).toBe("validate: no findings");
    expect(summaryLine({ summary: { errors: 1, warnings: 2, infos: 0 }, findings: [{ level: "error", code: "x", message: "m" }] }, "preflight")).toBe(
      "preflight: 1 error(s), 2 warning(s), 0 note(s)",
    );
    const lines = formatTestLines({
      tests: [
        { file: "tests/a.lua", name: "passes", ok: true },
        { file: "tests/a.lua", name: "fails", ok: false, message: "expected 1, got 2\nstack" },
      ],
      passed: 1,
      failed: 1,
      files: ["tests/a.lua"],
      engine: "wasmoon",
      output: ["hello"],
    });
    expect(lines).toEqual([
      "ok   tests/a.lua: passes",
      "FAIL tests/a.lua: fails",
      "       expected 1, got 2",
      "       stack",
      "     | hello",
      "1 of 2 test(s) passed in 1 file(s) (wasmoon)",
    ]);
  });
});

describe("mergeMcpConfig", () => {
  it("adds the server to a new or existing document and refuses broken JSON", () => {
    const entry = { command: "npx", args: ["-y", "@tmhs/rs3-plugin-mcp", "--workspace", "."] };
    expect(JSON.parse(mergeMcpConfig(undefined, "rs3-plugin", entry))).toEqual({ mcpServers: { "rs3-plugin": entry } });
    const existing = JSON.stringify({ mcpServers: { other: { command: "x", args: [] } }, note: "keep" });
    expect(JSON.parse(mergeMcpConfig(existing, "rs3-plugin", entry))).toEqual({
      mcpServers: { other: { command: "x", args: [] }, "rs3-plugin": entry },
      note: "keep",
    });
    expect(() => mergeMcpConfig("{ broken", "rs3-plugin", entry)).toThrow(/not valid JSON/);
  });
});
