# Changelog

All notable changes to RS3 Developer Tools will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Preflight `placeholder-email` warning; `package` refuses placeholder addresses (`--allow-placeholder-email` for tests) and ships `plugin.json` without `$schema`
- `.luarc.json` library path written relative to the plugin folder; `RS3_STUBS_DIR` override
- `@tmhs/rs3-plugin-mcp` ships a dedicated `dist/bin.js` executable so the npm bin symlink starts the server on Linux and macOS; a spawn smoke test guards it
- `rs3dev init --prettyui` whitelists the dependency global in `.luarc.json` (`diagnostics.globals`) and guards the first use, so the scaffold passes the LuaLS check it ships with; CI runs that check on plain and `--prettyui` scaffolds

### Fixed

- `scripts/luals-check.mjs` dropped the first LuaLS diagnostic when it shared a line with the progress output
- Preflight `sandbox-global` no longer fires on table constructor keys (`{ debug = false }`), goto labels or parameters; it now also reports `_G.os`, `_G["io"]` and `rawget(_G, "debug")`. An empty folder reports `manifest-missing` and `main-missing` only
- `DocsClient` aborts a fetch after `timeoutMs` (default 15 s), retries network errors, timeouts and 5xx once, and serves the cached copy when every attempt fails; `docs_get` and the stub crawl can no longer hang. Every workflow job has a `timeout-minutes`
- `require` validation reads calls from tokens (comments and strings no longer count), reports dotted names as `require-dotted` with the slash form to use, and points out an unloaded `init.lua`; `.luarc.json` now declares only `?.lua`, matching the documented client rule
- Preflight `url-outside-manifest` is an error only for a literal passed to `HTTPRequest`; a URL in help text or a log message is a warning. `chat-permission`, `http-permission` and `tracking-permission` skip chains rooted at a local of the file (`local Chat = {}`)
- `sync` and `watch` reject a `--root` or `RS3_DEV_PLUGINS_DIR` that does not exist or is not a `dev_plugins` folder (named so, or beside the client's `*.jcache` files) instead of creating it; `--create-root` opts in. The root itself is never created, a non-empty destination without a `plugin.json` is refused before pruning, paths are resolved through `realpath`, and `watch` runs syncs strictly one after another. The example MCP configs no longer hard-code a Windows `RS3_DEV_PLUGINS_DIR`
- `rs3dev watch --no-prune`; `package` writes to `dist/<plugin>-<version>.zip` under the current directory by default and the watcher ignores the same dev artefacts that `sync` and `package` exclude; `init` writes `urls` only from repeatable `--url name=https://host/` flags; `validate --strict` and `preflight --strict` fail on warnings
- `rs3dev doctor [path]` reports Node, the `dev_plugins` root and how it was chosen, the stubs folder and module count, the LuaLS binary, the plugin's `.luarc.json` library path and the docs cache, with a fix per missing item and exit code 1; `rs3dev cache path` and `rs3dev cache clear` expose the documentation cache
- Preflight lifecycle checks: `shutdown-missing` (error), `subscribe-without-unsubscribe` and `per-tick-scan` (warnings), `component-not-destroyed` (note), implemented in `lifecycle.ts` over the token stream of every Lua file
- Optional `rs3dev.json` (schema in `@tmhs/rs3-plugin-schema`): `preflight.ignore`, `preflight.maxLineLength`, `preflight.minCommentRatio`, `sync.root`, `sync.prune`, `package.outDir`; inline `-- rs3dev-ignore <code>` comments; `--ignore`, `--no-config` and `--format text|json|github|sarif` on `validate` and `preflight`; the MCP `guidelines_preflight` tool takes `ignore` and returns `suppressed`
- `docs_get` resolves `section` by anchor first, then heading, slices by recorded line offsets and returns a `DOCS_SECTION` error listing the anchors when a heading repeats; the page converter handles `dl`, nested lists, admonition titles and inline `code`
- The stub generator refuses to write (exit 2) when a crawl visits fewer than 50 pages or shrinks modules or symbols by more than 10 percent against the committed `index.json`, or when unresolved notes balloon; `--allow-shrink` overrides. `stubs-regenerate.yml` opens or updates a tracking issue and uploads the log instead of committing
- CI verifies the SHA-256 of the LuaLS archive before extracting it; jobs that can write (`stubs-regenerate.yml`, `release.yml`, `pages.yml`, `stale.yml`) pin GitHub actions to commit SHAs and read-only jobs check out with `persist-credentials: false`
- Weekly `audit.yml` runs `npm audit` over every dependency and `ci.yml` audits production dependencies on every push; Dependabot alerts and private vulnerability reporting are enabled on the repository
- Dev and runtime dependencies upgraded: vitest 5, zod 4 (the MCP SDK accepts `^3.25 || ^4`), commander 15, chokidar 6, `@types/node` 24 to match the CI Node range; TypeScript stays on 5.9 until the 7.0 compiler has been evaluated separately
- Stub generator regexes rewritten so whitespace is collapsed once and `<...>` groups are stripped in a single pass (clears the CodeQL polynomial-ReDoS and incomplete-sanitization alerts); output is byte-identical

### Changed

- Releases are manual (`gh workflow run release.yml`); Dependabot, stale and label-sync automation removed

## [0.1.0] - 2026-10-21

### Added

- `@tmhs/rs3-stubs-generator`: deterministic crawler for developer.runescape.com emitting LuaLS `---@meta` stubs (signatures and `@see` links only) with an `unresolved.md` report
- `@tmhs/rs3-luals-stubs`: 87 generated stub modules, `index.json`, `luarc.template.json`
- `@tmhs/rs3-plugin-schema`: `plugin.json` JSON Schema (draft 2020-12) with editor settings sample
- `@tmhs/rs3-devtools-core`: manifest validation, preflight checks, scaffold, dev_plugins sync with lock retries, debounced watch, deterministic zip packaging, docs client with ETag cache
- `rs3dev` CLI: `init`, `validate`, `preflight`, `sync`, `watch`, `package`
- `@tmhs/rs3-plugin-mcp`: stdio MCP server with `docs_search`, `docs_get`, `api_lookup`, `manifest_validate`, `guidelines_preflight`, `plugin_scaffold`, `devplugins_sync`, `package_zip`
- Cursor rules (9) and Claude Code skills (4) for RS3 plugin development, installed by `rs3dev init`
- `examples/hello-counter` reference plugin checked by LuaLS in CI
- CI on windows-latest and ubuntu-latest, scheduled stub regeneration committing to `main`
