# @tmhs/rs3-devtools-cli

The `rs3dev` command for RuneScape 3 plugin development.

```powershell
rs3dev init <name> [--permissions httpAccess,chatAccess] [--required-permissions ...] [--prettyui] [--email <address>] [--url api=https://host/ ...] [--stubs <dir>] [--no-agent-files] [--force] [-C <parent dir>]
rs3dev validate [path] [--strict] [--format text|json|github|sarif] [--ignore codes]
rs3dev preflight [path] [--max-line-length 200] [--strict] [--format text|json|github|sarif] [--ignore codes] [--no-config]
rs3dev sync [path] [--root <dev_plugins>] [--create-root] [--no-prune]
rs3dev watch [path] [--root <dev_plugins>] [--create-root] [--no-prune] [--debounce 300]
rs3dev package [path] [--out file.zip] [--overwrite] [--allow-placeholder-email]
rs3dev doctor [path] [--stubs <dir>]
rs3dev cache path | clear
rs3dev --json <command>
```

`doctor` is the first thing to run when something does not work: it prints the Node version, the `dev_plugins` root and how it was chosen (`override`, `env`, `detected`, or the candidates it checked), the stubs folder with its module count, whether `lua-language-server` runs, the plugin's `.luarc.json` library path when a path is given, and the documentation cache size. Each missing item comes with the fix, and the exit code is 1 when anything is missing. `cache clear` removes the documentation cache under `%LOCALAPPDATA%\rs3-devtools\cache` (or `$XDG_CACHE_HOME/rs3-devtools`).

`--json` is a global flag and goes before the command name. `init` writes `urls` only from `--url name=https://host/` flags (repeatable); with `httpAccess` and no `--url` the manifest gets an empty `urls` and `main.lua` says where to declare hosts.

| Command | Exit code |
| --- | --- |
| `validate`, `preflight` | 1 when any error-level finding exists; with `--strict`, warnings fail too |
| `sync`, `watch`, `package`, `init`, `cache` | 1 on failure |
| `doctor` | 1 when any row is missing |

`sync` copies (never junctions) into `<RuneScape-BETA>/dev_plugins/<folder>` and prints the console command `prl <folder>`. The root is taken from `--root`, then `RS3_DEV_PLUGINS_DIR`, then detected by finding a client folder containing `*.jcache` files. An explicit root must already exist and either be named `dev_plugins` or sit beside the client's `*.jcache` files; a typo fails with the resolved path instead of silently creating a folder elsewhere. Pass `--create-root` to accept and create an unusual layout. Because `sync` prunes files the source lacks, it also refuses a non-empty destination that holds no `plugin.json`. Files locked by the running client are retried with backoff; if they stay locked, disable the plugin with `poff <name>` and sync again.

`preflight` reads an optional `rs3dev.json` in the plugin folder (schema: `packages/schema/rs3dev.schema.json`): `preflight.ignore` lists reviewed finding codes to drop, `preflight.maxLineLength` and `preflight.minCommentRatio` tune the readability heuristics, `sync.root` and `sync.prune` set the `sync` defaults and `package.outDir` the archive folder. Flags override the file, `--no-config` skips it, and the file itself never ships (it is a development artefact like `.luarc.json`). A single finding can be suppressed next to the code with a `-- rs3dev-ignore <code>` comment on the line above or at the end of the line; suppressed findings are still counted in the summary and listed under `suppressed` in JSON output. `--format github` prints `::error file=...,line=...::` workflow commands so a plugin repository's Actions run shows annotations, and `--format sarif` writes a SARIF 2.1.0 log for `github/codeql-action/upload-sarif`.

Lifecycle checks: `shutdown-missing` (error) when any subscription exists without a `PluginShutdown`; `subscribe-without-unsubscribe` (warning) for an `Event.X.Subscribe(ref)` or `component:Subscribe(ui.Hook.Y)` with no matching unsubscribe on the same reference; `component-not-destroyed` (note) for a top-level `GroupBox`, `Layer` or `PagedLayer` never passed to `:Destroy()`; `per-tick-scan` (warning) for a `*List.All`, `*List.Find` or `GetAll` call inside an `Event.Logic` or `Event.Draw` handler that has no counter guard.

`watch` ignores the same development artefacts that `sync` and `package` exclude, so a zip or a `dist/` folder inside the plugin never triggers a re-sync.

`package` runs preflight first and refuses to build when it reports errors. The archive is written to `dist/<plugin>-<version>.zip` under the current directory unless `--out` is given. It has `plugin.json` and `main.lua` at its root and excludes dotfiles, `AGENTS.md`, `CLAUDE.md`, `node_modules`, `dist`, `tests` and other zips.
