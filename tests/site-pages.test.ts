import { promises as fsp } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSitePages, injectNavLinks, parseCliHelp } from "../scripts/build-site-pages.mjs";
import { repoRoot } from "./helpers.js";

// The Pages site adds an API symbol search and one page per rs3dev command and
// MCP tool beside the shared template's index.html (#35). Everything is
// generated from index.json, mcp-tools.json and the CLI's own help output.

const tempDirs: string[] = [];
async function tempDir(prefix: string): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await fsp.rm(dir, { recursive: true, force: true });
});

const NAV_MARKER = '<li><a href="#install">Install</a></li>';
// Built from code points so the formatter cannot turn the escapes into the characters the style test forbids.
const EM_OR_EN_DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

describe("scripts/build-site-pages.mjs", () => {
  it("parses the commander help into commands, joining wrapped descriptions and dropping help", () => {
    const help = [
      "Usage: rs3dev [options] [command]",
      "",
      "Options:",
      "  -h, --help                  display help for command",
      "",
      "Commands:",
      "  init [options] <name>       scaffold a new plugin folder named <name> in the",
      "                              current directory",
      "  stubs [options] <action>    'status' checks whether the installed stubs match",
      "  cache <action>              manage the documentation cache",
      "  help [command]              display help for command",
      "",
    ].join("\n");
    expect(parseCliHelp(help)).toEqual([
      { name: "init", args: "[options] <name>", description: "scaffold a new plugin folder named <name> in the current directory" },
      { name: "stubs", args: "[options] <action>", description: "'status' checks whether the installed stubs match" },
      { name: "cache", args: "<action>", description: "manage the documentation cache" },
    ]);
  });

  it("adds the API and Tools links to the template navigation once and leaves other markup alone", () => {
    const page = `<ul class="nav-links">${NAV_MARKER}</ul>`;
    const once = injectNavLinks(page);
    expect(once).toContain('<li><a href="api/">API</a></li><li><a href="tools/">Tools</a></li>');
    expect(injectNavLinks(once)).toBe(once);
    expect(injectNavLinks("<p>no nav here</p>")).toBe("<p>no nav here</p>");
  });

  it("builds the symbol search and a page for every command and MCP tool from the real sources", async () => {
    const out = await tempDir("rs3-site-");
    await fsp.writeFile(path.join(out, "index.html"), `<html><ul class="nav-links">${NAV_MARKER}</ul></html>`);
    const result = await buildSitePages({ out });
    const mcp = JSON.parse(await fsp.readFile(path.join(repoRoot, "mcp-tools.json"), "utf8")) as { tools: { name: string }[] };
    expect(result.tools).toEqual(mcp.tools.map((t) => t.name));
    expect(result.commands).toEqual(expect.arrayContaining(["init", "validate", "preflight", "sync", "watch", "package", "doctor", "adopt"]));
    expect(result.navUpdated).toBe(true);
    expect(await fsp.readFile(path.join(out, "index.html"), "utf8")).toContain('href="tools/"');

    // The API page ships the index beside it, unchanged, and finds symbols client-side.
    const indexText = await fsp.readFile(path.join(repoRoot, "packages", "luals-stubs", "index.json"), "utf8");
    expect(await fsp.readFile(path.join(out, "api", "index.json"), "utf8")).toBe(indexText);
    const api = await fsp.readFile(path.join(out, "api", "index.html"), "utf8");
    expect(api).toContain('fetch("index.json")');
    expect(api).toContain("PersistentDB:GetInt");
    expect(api).toContain("copyright Jagex");
    expect(api).toContain(`${result.symbols} symbols`);

    const tools = await fsp.readFile(path.join(out, "tools", "index.html"), "utf8");
    for (const name of result.tools) {
      expect(tools).toContain(`mcp-${name}.html`);
      const page = await fsp.readFile(path.join(out, "tools", `mcp-${name}.html`), "utf8");
      expect(page).toContain(`<h1>MCP tool ${name}</h1>`);
      expect(page).toContain("<th>Read only</th>");
    }
    for (const name of result.commands) {
      expect(tools).toContain(`cli-${name}.html`);
      const page = await fsp.readFile(path.join(out, "tools", `cli-${name}.html`), "utf8");
      expect(page).toContain(`Usage: rs3dev ${name}`);
    }
    // No documentation prose and no em or en dashes reach the generated pages.
    for (const file of result.written.filter((f) => f.endsWith(".html"))) {
      const text = await fsp.readFile(path.join(out, file), "utf8");
      expect(text, file).not.toMatch(EM_OR_EN_DASH);
    }
  }, 120000);
});
