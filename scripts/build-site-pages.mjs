// Build the pages that sit beside the shared site template's index.html on
// GitHub Pages: a searchable view of the stubs symbol index and one page per
// rs3dev command and MCP tool, all generated from the sources of truth
// (index.json, mcp-tools.json and the CLI's own --help output) so they cannot
// drift from the code.
//
//   node scripts/build-site-pages.mjs --out docs [--root <repo>]
//
// Output:
//   <out>/api/index.html, <out>/api/index.json   symbol search (name, kind, signature, docs link, stub file)
//   <out>/tools/index.html                        every rs3dev command and MCP tool, prompt and resource
//   <out>/tools/cli-<command>.html                the command's full --help text
//   <out>/tools/mcp-<tool>.html                   the tool's description, category and annotations
// When <out>/index.html exists (the template's page), "API" and "Tools" links
// are added to its navigation.
//
// Copyright: the API page carries signatures and links only; descriptions stay
// on developer.runescape.com.

import { execFileSync } from "node:child_process";
import { promises as fsp, realpathSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GITHUB = "https://github.com/TMHSDigital/RS3-Developer-Tools";

export function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Shared page frame: dark by default, light when the viewer asks, accent from site.json. */
export function pageFrame({ title, description, body, site, depth = 1, script = "" }) {
  const up = "../".repeat(depth);
  const accent = site.accent ?? "#c9a227";
  const accentLight = site.accentLight ?? "#e3c766";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<style>
:root { --accent: ${accent}; --accent-light: ${accentLight}; --bg: #0d1117; --bg2: #161b22; --border: #30363d; --text: #e6edf3; --dim: #8b949e; --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
@media (prefers-color-scheme: light) { :root { --bg: #ffffff; --bg2: #f6f8fa; --border: #d0d7de; --text: #1f2328; --dim: #57606a; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
a { color: var(--accent-light); text-decoration: none; }
a:hover { text-decoration: underline; }
header { border-bottom: 1px solid var(--border); background: var(--bg2); }
header .wrap { display: flex; gap: 1.25rem; align-items: center; padding: 0.75rem 1rem; }
header .brand { font-weight: 700; color: var(--text); }
header nav a { margin-right: 1rem; color: var(--dim); font-size: 0.9rem; }
header nav a.active { color: var(--accent-light); }
.wrap { max-width: 1100px; margin: 0 auto; padding: 0 1rem; }
main.wrap { padding: 1.5rem 1rem 3rem; }
h1 { font-size: 1.6rem; margin: 0 0 0.25rem; }
h2 { font-size: 1.2rem; margin: 2rem 0 0.75rem; border-bottom: 1px solid var(--border); padding-bottom: 0.25rem; }
h3 { font-size: 1rem; margin: 1.25rem 0 0.25rem; }
p.lead { color: var(--dim); margin: 0 0 1rem; }
code, pre { font-family: var(--mono); font-size: 0.85em; }
code { background: var(--bg2); padding: 0.1rem 0.35rem; border-radius: 4px; }
pre { background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; padding: 0.75rem 1rem; overflow-x: auto; }
pre code { background: none; padding: 0; }
.controls { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 1rem 0; }
.controls input, .controls select { background: var(--bg2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 1rem; }
.controls input { flex: 1 1 280px; }
.row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.2rem; padding: 0.6rem 0; border-bottom: 1px solid var(--border); }
.row .name { font-weight: 600; }
.row .meta { color: var(--dim); font-size: 0.85rem; }
.kind { display: inline-block; font-size: 0.75rem; border: 1px solid var(--border); border-radius: 999px; padding: 0 0.5rem; color: var(--dim); margin-left: 0.4rem; vertical-align: middle; }
.note { border-left: 3px solid var(--accent); padding: 0.5rem 0.75rem; background: var(--bg2); color: var(--dim); font-size: 0.9rem; margin: 1rem 0; }
table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
th, td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border); vertical-align: top; }
th { color: var(--dim); font-weight: 600; }
ul.plain { list-style: none; padding: 0; margin: 0; }
ul.plain li { padding: 0.35rem 0; border-bottom: 1px solid var(--border); }
footer { color: var(--dim); font-size: 0.8rem; padding: 1rem; text-align: center; border-top: 1px solid var(--border); }
</style>
</head>
<body>
<header><div class="wrap">
<a class="brand" href="${up}">RS3 Developer Tools</a>
<nav><a href="${up}api/"${title.startsWith("API") ? ' class="active"' : ""}>API</a><a href="${up}tools/"${title.startsWith("Tools") || title.startsWith("rs3dev ") || title.startsWith("MCP ") ? ' class="active"' : ""}>Tools</a><a href="${GITHUB}">GitHub</a><a href="https://developer.runescape.com/rs/">Official docs</a></nav>
</div></header>
<main class="wrap">
${body}
</main>
<footer>Signatures and links only. The RuneScape Client API documentation is copyright Jagex Ltd and lives at <a href="https://developer.runescape.com/rs/">developer.runescape.com</a>. Site generated from the repository sources.</footer>
${script}
</body>
</html>
`;
}

/** The searchable symbol page. The data is fetched from ./index.json beside it. */
export function renderApiPage(index, site) {
  const kinds = [...new Set(index.symbols.map((s) => s.kind))].sort();
  const sections = [...new Set(index.modules.map((m) => m.id.split("/")[0]))].sort();
  const source = index.source ?? {};
  const provenance = [
    `${index.symbols.length} symbols across ${index.modules.length} documentation pages`,
    source.indexLastModified ? `docs index last modified ${escapeHtml(source.indexLastModified)}` : "",
    source.generatorVersion ? `generator ${escapeHtml(source.generatorVersion)}` : "",
  ]
    .filter(Boolean)
    .join(". ");
  const body = `<h1>API symbol search</h1>
<p class="lead">Every class, method, field, enum, event and hook from the RuneScape Client API stubs. Type a name such as <code>PersistentDB:GetInt</code> or <code>Event.Logic</code>; each result links to its documentation anchor and to the stub file.</p>
<div class="note">${provenance}. Signatures only: descriptions are on the linked documentation pages. The same data is served to editors as <code>@tmhs/rs3-luals-stubs</code> and to agents through the MCP <code>api_lookup</code> tool.</div>
<div class="controls">
<input id="q" type="search" placeholder="Search symbols" autocomplete="off" autofocus>
<select id="kind"><option value="">All kinds</option>${kinds.map((k) => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join("")}</select>
<select id="section"><option value="">All sections</option>${sections.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}</select>
</div>
<p class="meta" id="status">Loading index...</p>
<div id="results"></div>`;
  const script = `<script>
(function () {
  var GITHUB = ${JSON.stringify(GITHUB)};
  var LIMIT = 300;
  var q = document.getElementById("q"), kind = document.getElementById("kind"), section = document.getElementById("section");
  var status = document.getElementById("status"), results = document.getElementById("results");
  var symbols = [];
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function rank(sym, needle) {
    var name = sym.name.toLowerCase();
    if (name === needle) return 0;
    var tail = name.split(/[.:]/).pop();
    if (tail === needle) return 1;
    if (name.indexOf(needle) === 0) return 2;
    if (name.indexOf(needle) >= 0) return 3;
    if (sym.signature.toLowerCase().indexOf(needle) >= 0) return 4;
    return -1;
  }
  function render() {
    var needle = q.value.trim().toLowerCase();
    var k = kind.value, s = section.value;
    var hits = [];
    for (var i = 0; i < symbols.length; i++) {
      var sym = symbols[i];
      if (k && sym.kind !== k) continue;
      if (s && sym.module.indexOf(s + "/") !== 0 && sym.module !== s) continue;
      var r = needle ? rank(sym, needle) : 5;
      if (r < 0) continue;
      hits.push([r, sym]);
    }
    hits.sort(function (a, b) { return a[0] - b[0] || (a[1].name < b[1].name ? -1 : a[1].name > b[1].name ? 1 : 0); });
    var shown = hits.slice(0, LIMIT);
    status.textContent = hits.length + " of " + symbols.length + " symbols" + (hits.length > LIMIT ? " (first " + LIMIT + " shown)" : "");
    var html = "";
    for (var j = 0; j < shown.length; j++) {
      var y = shown[j][1];
      html += '<div class="row"><div><a class="name" href="' + esc(y.url) + '">' + esc(y.name) + '</a><span class="kind">' + esc(y.kind) + '</span></div>' +
        '<div><code>' + esc(y.signature) + '</code></div>' +
        '<div class="meta">' + esc(y.module) + ' &middot; <a href="' + esc(y.url) + '">documentation</a> &middot; <a href="' + GITHUB + '/blob/main/packages/luals-stubs/' + esc(y.file) + '">stub file</a></div></div>';
    }
    results.innerHTML = html;
    var url = new URL(window.location.href);
    if (q.value) url.searchParams.set("q", q.value); else url.searchParams.delete("q");
    window.history.replaceState(null, "", url.toString());
  }
  var initial = new URL(window.location.href).searchParams.get("q");
  if (initial) q.value = initial;
  fetch("index.json").then(function (r) { return r.json(); }).then(function (data) {
    symbols = data.symbols || [];
    render();
  }).catch(function (err) { status.textContent = "Could not load index.json: " + err; });
  q.addEventListener("input", render);
  kind.addEventListener("change", render);
  section.addEventListener("change", render);
})();
</script>`;
  return pageFrame({
    title: "API symbol search",
    description: "Searchable index of the RuneScape Client API stubs with documentation links.",
    body,
    site,
    depth: 1,
    script,
  });
}

/** Parse the top-level `rs3dev --help` into its command list. */
export function parseCliHelp(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const commands = [];
  let inCommands = false;
  for (const line of lines) {
    if (/^Commands:/.test(line)) {
      inCommands = true;
      continue;
    }
    if (!inCommands) continue;
    if (/^\S/.test(line)) break;
    const m = /^ {2}(\S+)((?: \[options\])?(?: <[^>]+>| \[[^\]]+\])*)\s{2,}(.*)$/.exec(line);
    if (m) {
      commands.push({ name: m[1], args: m[2].trim(), description: m[3].trim() });
    } else if (commands.length > 0 && /^\s{10,}\S/.test(line)) {
      commands[commands.length - 1].description += ` ${line.trim()}`;
    }
  }
  return commands.filter((c) => c.name !== "help");
}

function annotationRows(tool) {
  const a = tool.annotations ?? {};
  const rows = [
    ["Category", tool.category],
    ["Read only", a.readOnlyHint ? "yes" : "no"],
    ["Destructive", a.destructiveHint ? "yes" : "no"],
    ["Idempotent", a.idempotentHint ? "yes" : "no"],
    ["Reaches outside the workspace", a.openWorldHint ? "yes" : "no"],
    ["Asks for confirmation", tool.requiresConfirm ? "yes" : "no"],
  ];
  return rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v ?? "")}</td></tr>`).join("");
}

export function renderToolsIndex(cliCommands, mcp, site) {
  const body = `<h1>Tools</h1>
<p class="lead">Every <code>rs3dev</code> command and every tool, prompt and resource of the <code>${escapeHtml(mcp.server ?? "rs3-plugin-mcp")}</code> MCP server. These pages are generated from the CLI's own help output and from <code>mcp-tools.json</code> at build time.</p>
<h2>rs3dev commands</h2>
<ul class="plain">${cliCommands
    .map(
      (c) =>
        `<li><a href="cli-${escapeHtml(c.name)}.html"><code>rs3dev ${escapeHtml(c.name)}${c.args ? ` ${escapeHtml(c.args)}` : ""}</code></a><br><span class="meta">${escapeHtml(c.description)}</span></li>`,
    )
    .join("")}</ul>
<h2>MCP tools</h2>
<ul class="plain">${(mcp.tools ?? [])
    .map(
      (t) =>
        `<li><a href="mcp-${escapeHtml(t.name)}.html"><code>${escapeHtml(t.name)}</code></a><span class="kind">${escapeHtml(t.category ?? "")}</span><br><span class="meta">${escapeHtml(t.description)}</span></li>`,
    )
    .join("")}</ul>
<h2>MCP prompts</h2>
<ul class="plain">${(mcp.prompts ?? []).map((p) => `<li><code>${escapeHtml(p.name)}</code><br><span class="meta">${escapeHtml(p.description)}</span></li>`).join("")}</ul>
<h2>MCP resources</h2>
<ul class="plain">${(mcp.resources ?? []).map((r) => `<li><code>${escapeHtml(r.uri)}</code><br><span class="meta">${escapeHtml(r.description)}</span></li>`).join("")}</ul>
<p class="meta">Install: <code>npm install -g @tmhs/rs3-devtools-cli</code>; MCP configuration examples are in <a href="${GITHUB}/tree/main/packages/mcp/examples">packages/mcp/examples</a>.</p>`;
  return pageFrame({ title: "Tools", description: "rs3dev commands and MCP tools of RS3 Developer Tools.", body, site, depth: 1 });
}

export function renderCliPage(command, helpText, site) {
  const body = `<h1>rs3dev ${escapeHtml(command.name)}</h1>
<p class="lead">${escapeHtml(command.description)}</p>
<pre><code>${escapeHtml(helpText.trim())}</code></pre>
<p class="meta"><a href="./">All tools</a> &middot; <a href="${GITHUB}/blob/main/packages/cli/README.md">CLI README</a></p>`;
  return pageFrame({ title: `rs3dev ${command.name}`, description: command.description, body, site, depth: 1 });
}

export function renderMcpToolPage(tool, mcp, site) {
  const body = `<h1>MCP tool ${escapeHtml(tool.name)}</h1>
<p class="lead">${escapeHtml(tool.description)}</p>
<table>${annotationRows(tool)}</table>
<p class="meta">Server <code>${escapeHtml(mcp.server ?? "")}</code>. The input schema is defined in <a href="${GITHUB}/blob/main/packages/mcp/src/server.ts">packages/mcp/src/server.ts</a>; the annotations above mirror <a href="${GITHUB}/blob/main/packages/mcp/src/annotations.ts">annotations.ts</a>.</p>
<p class="meta"><a href="./">All tools</a> &middot; <a href="${GITHUB}/blob/main/packages/mcp/README.md">MCP README</a></p>`;
  return pageFrame({ title: `MCP tool ${tool.name}`, description: tool.description, body, site, depth: 1 });
}

/** Add API and Tools links to the template's navigation; unchanged when the markup is not recognised. */
export function injectNavLinks(html) {
  const marker = '<li><a href="#install">Install</a></li>';
  if (!html.includes(marker) || html.includes('href="api/"')) return html;
  return html.replace(marker, `<li><a href="api/">API</a></li><li><a href="tools/">Tools</a></li>${marker}`);
}

function defaultCliHelp(root) {
  const cli = path.join(root, "packages", "cli", "dist", "cli.js");
  return (args) => execFileSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
}

/** Build every page into `out`. `cliHelp(args)` returns the CLI's output for tests. */
export async function buildSitePages({ out, root = repoRoot, cliHelp = defaultCliHelp(root) }) {
  const outDir = path.resolve(out);
  const site = JSON.parse(await fsp.readFile(path.join(root, "site.json"), "utf8"));
  const indexText = await fsp.readFile(path.join(root, "packages", "luals-stubs", "index.json"), "utf8");
  const index = JSON.parse(indexText);
  const mcp = JSON.parse(await fsp.readFile(path.join(root, "mcp-tools.json"), "utf8"));

  await fsp.mkdir(path.join(outDir, "api"), { recursive: true });
  await fsp.mkdir(path.join(outDir, "tools"), { recursive: true });
  await fsp.writeFile(path.join(outDir, "api", "index.json"), indexText);
  await fsp.writeFile(path.join(outDir, "api", "index.html"), renderApiPage(index, site));

  const commands = parseCliHelp(cliHelp(["--help"]));
  const written = ["api/index.html", "api/index.json", "tools/index.html"];
  await fsp.writeFile(path.join(outDir, "tools", "index.html"), renderToolsIndex(commands, mcp, site));
  for (const command of commands) {
    await fsp.writeFile(path.join(outDir, "tools", `cli-${command.name}.html`), renderCliPage(command, cliHelp(["help", command.name]), site));
    written.push(`tools/cli-${command.name}.html`);
  }
  for (const tool of mcp.tools ?? []) {
    await fsp.writeFile(path.join(outDir, "tools", `mcp-${tool.name}.html`), renderMcpToolPage(tool, mcp, site));
    written.push(`tools/mcp-${tool.name}.html`);
  }

  let navUpdated = false;
  const indexHtml = path.join(outDir, "index.html");
  const existing = await fsp.readFile(indexHtml, "utf8").catch(() => undefined);
  if (existing !== undefined) {
    const updated = injectNavLinks(existing);
    navUpdated = updated !== existing;
    if (navUpdated) await fsp.writeFile(indexHtml, updated);
  }
  return { outDir, written, commands: commands.map((c) => c.name), tools: (mcp.tools ?? []).map((t) => t.name), symbols: index.symbols.length, navUpdated };
}

async function main(argv) {
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const result = await buildSitePages({ out: value("--out") ?? "docs", root: value("--root") ? path.resolve(value("--root")) : repoRoot });
  console.log(
    `wrote ${result.written.length} files to ${result.outDir}: ${result.symbols} symbols, ${result.commands.length} commands, ${result.tools.length} MCP tools${result.navUpdated ? ", nav links added to index.html" : ""}`,
  );
}

const invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invoked === realpathSync(fileURLToPath(import.meta.url))) await main(process.argv.slice(2));
