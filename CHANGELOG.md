# Changelog

All notable changes to RS3 Developer Tools will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] - Unreleased

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
