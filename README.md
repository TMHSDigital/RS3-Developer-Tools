# RS3 Developer Tools

**Lua-native developer toolkit for official RuneScape 3 plugins: LuaLS stubs, manifest schema, the rs3dev CLI, an MCP server, and Cursor and Claude Code guidance.**

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](CHANGELOG.md)
[![CI](https://github.com/TMHSDigital/RS3-Developer-Tools/actions/workflows/ci.yml/badge.svg)](https://github.com/TMHSDigital/RS3-Developer-Tools/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/RuneScape%20Client%20API-docs-indigo.svg)](https://developer.runescape.com/rs/)

**[Install](#install)** - [Quick start](#quick-start) - [Troubleshooting](#troubleshooting) - [MCP server](#mcp-server) - [Packages](#packages) - [Skills](#skills) - [Rules](#rules) - [Copyright and AI policy](#copyright-and-ai-policy) - [Roadmap](ROADMAP.md)

> 5 skills - 9 rules - 9 MCP tools - 87 API stub modules

Official RS3 plugins are Lua 5.4.8 scripts run by the RuneScape beta client against the [RuneScape Client API](https://developer.runescape.com/rs/). This toolkit gives you type-checked completions for that API in any LuaLS-based editor, validates `plugin.json`, catches sandbox and permission problems before Jagex moderation does, copies your plugin into the client's `dev_plugins` folder on save, and builds the zip you upload to mod.io. The same functions are exposed to AI agents through an MCP server and documented for them through Cursor rules and Claude Code skills.

### Who this is for

Anyone writing a plugin for the official RuneScape 3 client in Lua: you have (or want) a folder with `plugin.json` and `main.lua`, you edit it in Cursor, VS Code or Neovim, and you want the API checked as you type, the moderation rules checked before you upload, and the copy into the client to happen on save. If you already have a plugin, start at [Have a plugin already?](#have-a-plugin-already). If you work with an AI agent, the MCP server and the rules give it the same checks and the same policy.

**Status:** early (0.1.0). The stubs regenerate from the documentation every week and a few types the docs never declare are aliased to `any` (listed in [`unresolved.md`](packages/luals-stubs/unresolved.md)). npm publishing is pending, so the install is a clone.

## Install

The toolkit runs on Windows, macOS and Linux; it needs Node.js 22 or later, Git, and `lua-language-server` for the command line LuaLS check (the Lua extension in Cursor or VS Code ships its own copy for the editor).

Windows 11 (PowerShell):

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install LuaLS.lua-language-server
```

macOS (Homebrew):

```bash
brew install node git lua-language-server
```

Linux (Debian or Ubuntu shown; any distribution works with `nvm` for Node):

```bash
sudo apt install git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
# lua-language-server: unpack the linux-x64 tarball from https://github.com/LuaLS/lua-language-server/releases
# and put bin/lua-language-server on PATH, or set LUA_LANGUAGE_SERVER to it
```

Install the toolkit from this repository (npm publishing is planned; see [ROADMAP.md](ROADMAP.md)). The commands are the same in every shell:

```bash
git clone https://github.com/TMHSDigital/RS3-Developer-Tools.git
cd RS3-Developer-Tools
npm install
npm run build
npm link --workspace packages/cli         # exposes the rs3dev command
```

If `npm install` fails with `EISDIR ... symlink`, the clone is on a filesystem without symlink support (exFAT). Run `npm install --workspaces=false --ignore-scripts` followed by `npm run build`; the build script copies the workspace packages into `node_modules` instead of linking them.

### Claude Code plugin (skills and MCP server, no clone)

This repository is also a Claude Code plugin marketplace. Two commands install the five skills and register the MCP server in any project:

```bash
claude plugin marketplace add TMHSDigital/RS3-Developer-Tools
claude plugin install rs3-developer-tools@rs3-developer-tools
```

The plugin starts the server with `npx -y @tmhs/rs3-plugin-mcp`, so it needs the packages on npm (planned, see [ROADMAP.md](ROADMAP.md)); until then use a clone with `packages/mcp/examples/monorepo.mcp.json`. Cursor users get the same rules and skills with `rs3dev init` or `rs3dev adopt`, which copy them into the plugin folder, or by opening this repository, whose `.cursor-plugin/plugin.json` lists them.

The beta client folder is detected on every platform from its `*.jcache` files: `C:\ProgramData\Jagex\RuneScape-BETA` on Windows, `~/Jagex/RuneScape-BETA` on macOS, and on Linux the Bolt launcher (`~/.local/share/bolt-launcher/jagex/RuneScape-BETA`) or the Flatpak Jagex Launcher Wine prefix. Anything else: set `RS3_DEV_PLUGINS_DIR` to the `dev_plugins` folder or pass `--root`. `rs3dev doctor` prints which folder was found.

## Quick start

The commands below are identical in PowerShell, bash and zsh.

```powershell
# 1. Scaffold a plugin. The folder name is the identifier the client console uses.
rs3dev init my-plugin --permissions chatAccess
cd my-plugin

# 2. Open the folder in Cursor or VS Code. .luarc.json already points LuaLS at the stubs;
#    hover PersistentDB or ui.Button for the signature and a link to the docs page.
#    In plugin.json, set contactEmailAddress to the address users should write to
#    (or pass --email <address> to init). Step 5 refuses the scaffolded placeholder.

# 3. Check the manifest and the code, then run the tests. init wrote tests/main_test.lua;
#    the tests run against fakes generated from the API stubs, no client needed.
rs3dev validate
rs3dev preflight
rs3dev test

# 4. Copy into the client's dev_plugins folder (detected by the *.jcache files beside it,
#    or set RS3_DEV_PLUGINS_DIR / pass --root), then reload in the client console (ALT+`):
rs3dev sync
#    prf        refresh the plugin list
#    pon my-plugin
#    prl my-plugin   after every edit, or let rs3dev watch sync on save:
rs3dev watch

# 5. Build the zip for mod.io. Upload is manual and reviewed by Jagex moderators.
rs3dev package
```

### What it looks like

`rs3dev preflight` on a plugin that leaks a subscription, never destroys a layer and scans the NPC list every tick:

```
WARNING main.lua:28 [subscribe-without-unsubscribe] Event.Draw.Subscribe(REFS.draw) has no matching Event.Draw.Unsubscribe(...) with the same reference; the handler leaks on reload
  see https://developer.runescape.com/rs/core/events.html
WARNING main.lua:38 [subscribe-without-unsubscribe] button:Subscribe(ui.Hook.ONBUTTONPRESSED) has no matching button:Unsubscribe(...) in PluginShutdown; the hook stays attached after a reload
  see https://developer.runescape.com/rs/ui/component.html#unsubscribe
INFO main.lua:11 [component-not-destroyed] ui.Layer "overlay" is created at the top level but never passed to overlay:Destroy(); destroy it in PluginShutdown so a reload does not draw it twice
  see https://developer.runescape.com/rs/ui/component.html#destroy
WARNING main.lua:22 [per-tick-scan] NPCList.All(...) runs inside the Event.Logic handler on every tick; cache the result and refresh it on a counter (for example every 50 ticks)
  see https://developer.runescape.com/rs/core/events.html#logic
preflight: 0 error(s), 4 warning(s), 1 note(s)
```

In the editor, hovering `PersistentDB:GetInt` or `ui.Button.new` shows the typed signature from the stubs and a `@see` link to the exact documentation page; an undefined API symbol is an error on the line.

`rs3dev --json <command>` prints machine-readable output. Every validate and preflight finding links to the documentation page that states the rule.

`rs3dev init` writes a placeholder `contactEmailAddress` (`change-me@example.com`). Preflight reports it as a `placeholder-email` warning and `rs3dev package` refuses to build until a real address is set; addresses on `example.com`, `example.org`, `example.net` or containing `change-me` count as placeholders. The shipped `plugin.json` inside the zip has the editor-only `$schema` key removed.

### Have a plugin already?

Run the toolkit on the folder you have; nothing in it is rewritten:

```powershell
cd my-existing-plugin
rs3dev adopt .            # .luarc.json plus AGENTS.md, Cursor rules and Claude Code skills
rs3dev adopt . --vendor   # same, with the stubs copied into .rs3/stubs so .luarc.json works on every machine
rs3dev validate . ; rs3dev preflight .
```

`rs3dev init <folder> --existing` does the same. When completions stop because the stubs moved (npm update, another drive, a teammate's machine), `rs3dev validate` reports `luarc-stale` and `rs3dev luarc .` re-points `.luarc.json`; `rs3dev doctor` shows where the stubs are.

### LuaLS stubs location

`.luarc.json` points `workspace.library` at the stubs folder. The path is written relative to the plugin folder, but it is still specific to the machine it was written on (it leads into the npm install or the checkout), so do not commit it as is: a collaborator runs `rs3dev luarc .` once, or you vendor the stubs with `rs3dev luarc . --vendor` (about 11 MB under `.rs3/stubs`, a dotfolder that never ships; refresh it after a stubs update). The folder is found in this order: `--stubs <dir>`, the `RS3_STUBS_DIR` environment variable, the `@tmhs/rs3-luals-stubs` package installed next to the CLI, then the monorepo checkout. Set `RS3_STUBS_DIR` when you keep a regenerated copy of the stubs somewhere else:

```powershell
$env:RS3_STUBS_DIR = "C:\dev\RS3-Developer-Tools\packages\luals-stubs\stubs"
```

```bash
export RS3_STUBS_DIR=~/dev/RS3-Developer-Tools/packages/luals-stubs/stubs
```

### Editor completions without the CLI

The stubs are plain `---@meta` files and need neither Node nor this toolkit. Every GitHub Release carries two zips: `rs3-luals-stubs-<version>.zip` (the `stubs/` folder, `index.json`, `luarc.template.json`) and `rs3-client-api-luals-addon-<version>.zip` (the same stubs in LuaLS addon layout with `config.json` and `info.json`, built by `scripts/build-luals-addon.mjs`). Unpack either and point `workspace.library` in your `.luarc.json` at the stubs folder with `runtime.version` set to `Lua 5.4`; Neovim, Zed and other LuaLS editors work the same way. A "RuneScape Client API" entry in the LuaLS addon manager is planned from the addon zip (see issue 24).

### Documentation site

[tmhsdigital.github.io/RS3-Developer-Tools](https://tmhsdigital.github.io/RS3-Developer-Tools/) renders the skills and rules, a [searchable index of every API symbol](https://tmhsdigital.github.io/RS3-Developer-Tools/api/) (type `PersistentDB:GetInt`, get the signature, the documentation anchor and the stub file) and [a page for every `rs3dev` command and MCP tool](https://tmhsdigital.github.io/RS3-Developer-Tools/tools/). The pages are generated from `index.json`, `mcp-tools.json` and the CLI's own `--help` output on every deploy, so they cannot drift from the code. Signatures and links only; the descriptions stay on developer.runescape.com.

### API change digest

The weekly stub regeneration diffs `index.json` and writes what changed in the RuneScape Client API (symbols added, removed or re-signed, each with its docs link) to [api-changes.md](api-changes.md), the commit body and an Announcements post in [Discussions](https://github.com/TMHSDigital/RS3-Developer-Tools/discussions). Watch the repository to follow it.

## How it works

```mermaid
flowchart LR
  Docs[developer.runescape.com] -->|crawl, signatures only| Gen[stubs-generator]
  Gen --> Stubs[luals-stubs<br>---@meta files + index.json]
  Stubs --> Editor[LuaLS in Cursor / VS Code]
  Stubs --> MCP[rs3-plugin-mcp]
  Schema[plugin.schema.json] --> Core[core: validate, preflight,<br>scaffold, sync, package]
  Core --> CLI[rs3dev]
  Core --> MCP
  Rules[cursor-plugin rules + skills] --> Editor
  CLI -->|copy| Dev[RuneScape-BETA/dev_plugins]
  CLI -->|zip| Modio[manual upload to mod.io]
```

## MCP server

`@tmhs/rs3-plugin-mcp` is a stdio MCP server that exposes the same functions to Claude Code, Cursor and other MCP clients. Copy one of the example configurations:

| Client | File |
| --- | --- |
| Claude Code | [`packages/mcp/examples/claude-code.mcp.json`](packages/mcp/examples/claude-code.mcp.json) to `.mcp.json` in your plugin workspace |
| Cursor | [`packages/mcp/examples/cursor.mcp.json`](packages/mcp/examples/cursor.mcp.json) to `.cursor/mcp.json` |
| This repository | [`packages/mcp/examples/monorepo.mcp.json`](packages/mcp/examples/monorepo.mcp.json) |

Set `RS3_DEV_PLUGINS_DIR` when the client folder is not at the default location. The server reads and writes only inside the workspace it was started for (`--workspace`) and the `dev_plugins` root; `devplugins_sync` requires `confirm=true`.

| Tool | Description |
| --- | --- |
| `docs_search` | Search API symbols and documentation pages by name and return signatures with docs URLs. |
| `docs_get` | Fetch a developer.runescape.com page live with a local ETag cache and return its text or one section. |
| `api_lookup` | Return the LuaLS signature, stub file and docs URL for an API symbol. |
| `manifest_validate` | Validate a plugin folder's plugin.json against the schema and check the folder structure. |
| `guidelines_preflight` | Run static sandbox, permission and readability checks and link each finding to the docs. |
| `plugin_scaffold` | Create a new plugin folder inside the workspace without overwriting existing files. |
| `devplugins_sync` | Copy a plugin into the client's dev_plugins root, replacing the previous copy. Requires confirm=true. |
| `package_zip` | Run preflight and build the mod.io zip inside the workspace dist folder. |

## Packages

| Package | Folder | Purpose |
| --- | --- | --- |
| `@tmhs/rs3-stubs-generator` | `packages/stubs-generator` | Crawls the docs navigation and emits deterministic LuaLS `---@meta` stubs (signatures and `@see` links only) |
| `@tmhs/rs3-luals-stubs` | `packages/luals-stubs` | Generated stubs, `index.json`, `unresolved.md`, `.luarc.json` template |
| `@tmhs/rs3-plugin-schema` | `packages/schema` | `plugin.json` JSON Schema (draft 2020-12) and VS Code settings sample |
| `@tmhs/rs3-devtools-core` | `packages/core` | Validation, preflight, scaffold, sync, watch, package, docs cache |
| `@tmhs/rs3-devtools-cli` | `packages/cli` | The `rs3dev` command |
| `@tmhs/rs3-plugin-mcp` | `packages/mcp` | stdio MCP server |

## Skills

| Skill | What it does |
| --- | --- |
| **new-plugin** | Scaffold a plugin, wire LuaLS, sync it into the client for the first time |
| **add-ui-window** | Build a GroupBox window with labels and buttons on the plugin layer and destroy it on shutdown |
| **add-event-handler** | Subscribe to a client event with a typed callback and a namespaced reference, released in PluginShutdown |
| **add-tests** | Write `tests/*.lua` that run outside the client with `rs3dev test`: load, clicks, events, persistence, PluginShutdown |
| **preflight-and-package** | Validate, preflight, fix, zip, and walk the manual mod.io submission |

Skills live in `cursor-plugin/skills/`; `rs3dev init` copies them to `.claude/skills/` in the new plugin folder.

## Rules

| Rule | What it enforces |
| --- | --- |
| **rs3-lua-idioms** | Plain Lua 5.4.8, locals everywhere, relative `require`, no sandbox-forbidden libraries |
| **rs3-events** | Namespaced subscription references and cleanup in `PluginShutdown` |
| **rs3-permissions** | Declare permissions in the manifest and gate optional ones with `Plugin.HasPermission` |
| **rs3-persistentdb** | Typed accessors and keys scoped per character |
| **rs3-prettyui** | PrettyUI through the manifest, exported table treated as read-only |
| **rs3-readability** | No minified, transpiled, encoded or unreviewed generated code |
| **rs3-ai-policy** | Only the workspace and developer.runescape.com are inputs; link docs, never paste them |
| **rs3-manifest** | `plugin.json` fields, dependency forms, permission lists, urls |
| **rs3-secrets** | No credentials in plugins or tooling |

Rules live in `cursor-plugin/rules/`; `rs3dev init` copies them to `.cursor/rules/`.

## Troubleshooting

Run `rs3dev doctor` first: it prints the Node version, the `dev_plugins` root and how it was found, the stubs folder, whether `lua-language-server` runs, the plugin's `.luarc.json` and the docs cache, with a fix for each missing row.

| Symptom | Cause and fix |
| --- | --- |
| `Could not find the RS3 beta client (no *.jcache files in ...)` from `sync` or `watch` | Detection looks for the client's `*.jcache` files in the default install folder for your platform (see Install). Set `RS3_DEV_PLUGINS_DIR` to the `dev_plugins` folder or pass `--root`; the folder must exist and be named `dev_plugins` or sit beside the `*.jcache` files. |
| Every API symbol is underlined as undefined, or there are no completions | The `.luarc.json` library path no longer resolves (stubs moved, another machine). `rs3dev validate .` reports `luarc-stale`; run `rs3dev luarc .` to re-point it or `rs3dev luarc . --vendor` to copy the stubs into the plugin. Also check the Lua extension (`sumneko.lua`) is installed; `rs3dev init` recommends it in `.vscode/extensions.json`. |
| `rs3dev package` stops with `[placeholder-email]` | `contactEmailAddress` in `plugin.json` is still a placeholder (`example.com`, `change-me`). Set the address users should write to; it is a legal requirement. |
| `sync` reports a file is locked (`EBUSY`, `EPERM`) | The client holds the file. Disable the plugin in the console with `poff <name>`, sync again, then `pon <name>`. |
| `prl <name>` does nothing or the plugin is not in `plist` | Run `prf` to refresh the plugin list first. The identifier is the folder name inside `dev_plugins`; `rs3dev sync` prints the destination it copied to. |
| `npm install` fails with `EISDIR ... symlink` | The clone sits on a filesystem without symlink support (exFAT). Run `npm install --workspaces=false --ignore-scripts` then `npm run build`. |
| `preflight` flags something you have reviewed | Put the code under `preflight.ignore` in `rs3dev.json`, or add `-- rs3dev-ignore <code>` on the line above; suppressed findings are still listed in `--json` output. |

## How it compares

- Plain LuaLS with no stubs: the editor knows Lua, not the Client API, so every `ui.`, `Event.` and `PersistentDB` call is untyped and typos surface in the client.
- A hand-written `.luarc.json` pointing at stubs you maintain: works until the API changes; the stubs here are regenerated from the documentation every week, carry only signatures and `@see` links (the documentation is copyright Jagex), and ship with a change digest.
- This toolkit adds what the stubs cannot: manifest validation, the moderation checks, the copy into `dev_plugins`, the zip, and the same functions for AI agents through MCP, all built from your workspace and the official documentation only, as Jagex's AI policy requires.

## Copyright and AI policy

- The RuneScape Client API documentation is copyright Jagex. This repository does not mirror or bundle it. The generated stubs contain only names, parameter and return types, fields, and enumeration members, each with a `@see` link to the exact page. Page content is fetched at runtime by `docs_get` and cached under `%LOCALAPPDATA%\rs3-devtools\cache`, never committed.
- Jagex's AI policy applies to every tool here: the generator, CLI and MCP server read only your own workspace and developer.runescape.com. They never ingest, index, or send to a model any other developer's plugin code, including mod.io downloads and third-party repositories. The MCP server refuses paths outside the workspace and `dev_plugins`.
- Everything the toolkit generates is plain, commented Lua. Moderation rejects code that is hard to follow, so read and test every generated line before submitting.
- Distribution is a manual upload to mod.io with Jagex moderator approval; the mod.io API is disabled for this game, so there is no upload automation.

Ambiguous API surface and every inference the generator made are listed in [`packages/luals-stubs/unresolved.md`](packages/luals-stubs/unresolved.md).

## Project structure

```
RS3-Developer-Tools/
  .cursor-plugin/plugin.json   Cursor plugin manifest (version source of truth)
  cursor-plugin/               rules/, skills/, AGENTS.md installed into plugin workspaces
  examples/                    four reference plugins, each LuaLS-checked and packaged in CI
  packages/                    npm workspaces (see Packages)
  scripts/                     build, workspace linking, LuaLS check
  tests/                       repository-level tests (skills, rules, mcp-tools, style)
  .github/workflows/           CI, scheduled stub regeneration, validate, release, pages
```

## Development

```powershell
npm install
npm run build          # builds every package in dependency order
npm test               # one vitest run over the repository tests and every package
npm run test:coverage  # the same with the v8 coverage report and thresholds
npm run lint           # Biome lint and format check (npm run format applies fixes)
npm run stubs:generate # regenerate packages/luals-stubs from the live docs
npm run luals:check    # requires lua-language-server on PATH or LUA_LANGUAGE_SERVER
```

Releases are cut manually. The workflow reads the conventional commits since the last tag, bumps every version field, tags and publishes the GitHub Release:

```powershell
gh workflow run release.yml
```

Dependency updates are applied manually on `main`; there is no Dependabot configuration. See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## License

MIT. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). RuneScape is a trademark of Jagex Ltd; this project is not affiliated with Jagex.

**Built by TMHSDigital**
