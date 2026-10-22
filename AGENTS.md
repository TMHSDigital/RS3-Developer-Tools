<!-- standards-version: 1.10.1 -->

# AGENTS.md

This file tells AI coding agents how the RS3 Developer Tools repo works and how to contribute correctly. For guidance inside a plugin workspace created by `rs3dev init`, see `cursor-plugin/AGENTS.md`.

**Documentation site:** https://tmhsdigital.github.io/RS3-Developer-Tools/ (auto-deployed on push to main)

## Repository overview

This is a Cursor IDE plugin plus an npm workspaces monorepo for RuneScape 3 plugin development. It contains:

- **`.cursor-plugin/plugin.json`** -- plugin manifest (version source of truth, skill and rule paths)
- **`cursor-plugin/`** -- 4 SKILL.md files, 9 .mdc rule files and the AGENTS.md installed into plugin workspaces
- **`packages/stubs-generator/`** -- TypeScript crawler that turns developer.runescape.com into LuaLS `---@meta` stubs
- **`packages/luals-stubs/`** -- generated stubs (committed), `index.json`, `unresolved.md`, `luarc.template.json`
- **`packages/schema/`** -- `plugin.schema.json` (draft 2020-12) and `settings.sample.json`
- **`packages/core/`** -- validate, preflight, scaffold, sync, watch, package, docs client with ETag cache
- **`packages/cli/`** -- `rs3dev` (commander)
- **`packages/mcp/`** -- `@tmhs/rs3-plugin-mcp` stdio server with 8 tools
- **`examples/hello-counter/`** -- reference plugin; CI runs `lua-language-server --check` on it with the stubs
- **`tests/`** -- repository tests: skills and rules frontmatter, `mcp-tools.json`, README counts, writing style
- **`scripts/`** -- `build-all.mjs`, `link-workspaces.mjs`, `luals-check.mjs`
- **`mcp-tools.json`**, **`site.json`** -- inputs for the docs site and ecosystem checks
- **`CHANGELOG.md`** -- manually maintained release history

## Branching and commit model

- **Single branch**: `main` only. No develop or release branches, no worktrees, no pull requests in the normal flow; commit directly to `main` in small logical commits and push after each working milestone.
- **Never force push, never rewrite history.** If a push is rejected, `git pull --rebase origin main`, resolve, push again.
- **Conventional commits** are required. The release workflow parses them:
  - `feat:` or `feat(scope):` -- minor version bump
  - `feat!:` or `BREAKING CHANGE` -- major version bump
  - everything else (`fix:`, `chore:`, `docs:`, `test:`, `ci:`) -- patch bump
- Commit messages describe the why. No emojis, no em dashes.

## CI/CD workflows

See [`.github/workflows/README.md`](.github/workflows/README.md) for the full table.

- `ci.yml` (push, PR): build, `npm test`, validate and preflight the example, LuaLS check on windows-latest and ubuntu-latest.
- `stubs-regenerate.yml` (weekly, manual): regenerates stubs, runs tests and the LuaLS check, commits `chore(stubs): regenerate from docs` directly to `main` as github-actions[bot].
- `validate.yml` (push, PR): manifest fields, skill and rule frontmatter, README counts, credential scan, em dash and emoji check.
- `release.yml` (manual, `gh workflow run release.yml`): bumps `.cursor-plugin/plugin.json`, root and workspace `package.json` versions, tags, creates the GitHub Release.
- `drift-check.yml`, `pages.yml`, `codeql.yml`: ecosystem standard workflows. There is no Dependabot, stale or label-sync automation; dependency updates are applied manually on `main`.

## Version management

- The **source of truth** for the current version is `.cursor-plugin/plugin.json`. Every `package.json` carries the same version and the schemas test enforces it.
- The release workflow bumps them and the README badge when a maintainer runs it. Never change versions by hand.

## Code conventions

- No emojis and no em or en dashes anywhere: code, docs, commits, CLI output. `tests/style.test.ts` and `validate.yml` fail on them.
- Text files are UTF-8 without BOM with LF line endings (`.gitattributes` enforces LF).
- TypeScript: strict, ESM (`"type": "module"`, `.js` import specifiers), Node 22+, `noUncheckedIndexedAccess`. Tests with vitest only.
- Generated Lua (scaffold templates, stubs) must be readable and commented; moderators reject code that is hard to follow.
- Windows-safe paths everywhere: use `node:path`, never string concatenation with `/`.
- Docs are link-only. Never commit prose from developer.runescape.com. Stubs carry signatures and `@see` URLs; the MCP `docs_get` tool fetches pages at runtime into the per-user cache.
- Jagex AI policy: tooling must never ingest, index, or send to a model any other developer's plugin code or docs (mod.io plugins, third-party repositories). Index only the user's own workspace and developer.runescape.com. The MCP server enforces this with path checks; do not relax them.
- The `rs3-api-ts` project was named as a possible signature cross-check; it was not reachable when this toolkit was built and nothing from it is used. If that changes, attribute it in `NOTICE.md`.
- Dependencies are pinned to a minor range in each `package.json` and also listed in the root `devDependencies` so a local install works without workspace symlinks (exFAT); keep both lists in sync.

## Adding content

### New skill

1. Create `cursor-plugin/skills/<name>/SKILL.md` with frontmatter `name`, `description`, `triggers` (3 to 8), `standards-version`.
2. Add the path to `.cursor-plugin/plugin.json` under `"skills"`.
3. Update the skills count and table in `README.md`.
4. Commit with `feat(skills):`.

### New rule

1. Create `cursor-plugin/rules/rs3-<topic>.mdc` with frontmatter `description`, `globs`, `alwaysApply`, `standards-version`; under 100 lines.
2. Add the path to `.cursor-plugin/plugin.json` under `"rules"`.
3. Update the rules count and table in `README.md`.

### New MCP tool

1. Register it in `packages/mcp/src/server.ts` with `server.registerTool`; return errors as `{ isError: true, content: [...] }`, never throw.
2. Write tools take explicit paths and go through `checkWritable`; destructive tools take `confirm`.
3. Add the entry to `mcp-tools.json`, the README table, and `tests/mcp-tools.test.ts` expectations; add a happy-path test in `packages/mcp/src/__tests__/server.test.ts`.

### New preflight check

1. Add the check to `packages/core/src/preflight.ts` with a stable `code` and a `docsUrl` from `DOCS`.
2. Add a fixture under `packages/core/src/__tests__/fixtures/plugins/` and a test.

### Stub generator change

1. Edit `packages/stubs-generator/src/*.ts`; keep output deterministic (sorted sets, document order, no timestamps).
2. Document facts the parser cannot derive in `overrides.json` with a `see` anchor and a `reason`.
3. Run `npm run build && npm run stubs:generate && npm test && npm run luals:check` and commit the regenerated stubs together with the code.

## MCP server

Executable entry point `packages/mcp/src/bin.ts` (stdio, always starts the server); `packages/mcp/src/index.ts` only re-exports `createServer` for tests and embedders. Tools are defined in `packages/mcp/src/server.ts` and call `@tmhs/rs3-devtools-core`. The workspace root comes from `--workspace`, `RS3_WORKSPACE`, or the current directory. Tool names follow the toolkit specification (`docs_search`, `api_lookup`, ...) rather than the ecosystem `<prefix>_<verbNoun>` convention; `mcp-tools.json` records this.

## Key technical facts

- Plugins: Lua 5.4.8, folder with `main.lua`, `plugin.json`, optional `resources/`; `require("path")` is relative to the plugin root without extension.
- Manifest fields: `name`, `version`, `contactEmailAddress`, `requiredDependencies`, `optionalDependencies` (array or alias map), `requiredPermissions`, `optionalPermissions`, `urls`, `hasSettingsIcon`, `hasRibbonIcon`. Permissions: `httpAccess`, `chatAccess`, `trackingAccess`.
- Dev root on Windows: `C:\ProgramData\Jagex\RuneScape-BETA\dev_plugins\<plugin>\`, detected by `*.jcache` files in the client folder; override with `RS3_DEV_PLUGINS_DIR` or `--root`. Console: `prf`, `plist`, `pon`, `poff`, `prl`.
- Sandbox forbids `os`, `io`, `debug`, `load`, `loadstring`, `dofile`.
- `contactEmailAddress` on `example.com`, `example.org`, `example.net` or containing `change-me` is a placeholder: preflight warns (`placeholder-email`), package refuses unless `--allow-placeholder-email` (tests only). The zip ships `plugin.json` without `$schema`, four-space indented.
- Stubs folder resolution for `.luarc.json`: `--stubs`, then `RS3_STUBS_DIR`, then `require.resolve("@tmhs/rs3-luals-stubs/package.json")` from the CLI, then the monorepo; the path is written relative to the plugin folder when the drives match.
- The client calls `PluginShutdown()` on disable or reload and `PluginDependencyUpdate(event)` when an optional dependency toggles.
- Events: `Event.<Name>.Subscribe(ref, fn)` / `Unsubscribe(ref)`; component hooks: `component:Subscribe(ui.Hook.X, [id,] fn)`.
- Stub output: `packages/luals-stubs/stubs/<section>/<page>.lua`, plus `_globals.lua` (`config`, `id`, `var`), `_namespaces.lua`, `_extras.lua`, `_unresolved.lua`.

## License

MIT (see `LICENSE`). Contributions are accepted under the DCO and inbound grant in `CONTRIBUTING.md`. The RuneScape Client API documentation is copyright Jagex and is not redistributed here.
