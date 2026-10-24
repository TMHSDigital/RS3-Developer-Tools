<!-- standards-version: 1.10.1 -->

# CLAUDE.md

Guidance for Claude Code when working in this repository. `AGENTS.md` is the full guide; this file is the short version.

## Project

RS3 Developer Tools -- Lua-native developer toolkit for official RuneScape 3 plugins

**Version:** 0.1.0
**License:** MIT
**Author:** TMHSDigital

## Key paths

- Plugin manifest: `.cursor-plugin/plugin.json` (version source of truth); Claude Code plugin: `.claude-plugin/plugin.json` and `marketplace.json`
- Skills: `cursor-plugin/skills/*/SKILL.md`
- Rules: `cursor-plugin/rules/*.mdc`
- Packages: `packages/{stubs-generator,luals-stubs,schema,core,cli,mcp}`
- Example plugin: `examples/hello-counter`
- MCP server: `packages/mcp/src/server.ts`
- CI workflows: `.github/workflows/`

## Commands

```powershell
npm install            # on exFAT: npm install --workspaces=false --ignore-scripts
npm run build          # scripts/build-all.mjs, dependency order, refreshes node_modules/@tmhs copies
npm test               # one vitest run: tests/ plus every package (npm run test:coverage for the report)
npm run lint           # Biome lint and format check; npm run format applies fixes
npm run stubs:generate # live crawl; commit the result with the generator change
npm run luals:check    # needs lua-language-server (LUA_LANGUAGE_SERVER or PATH)
node packages/cli/dist/cli.js preflight examples/hello-counter
```

## Conventions

- Work on `main` only; small conventional commits; never force push.
- No emojis, no em or en dashes anywhere. A test enforces it.
- Never commit documentation prose from developer.runescape.com. Stubs carry signatures and `@see` links only.
- Never read or index other developers' plugin code; only this workspace and developer.runescape.com.
- Generated Lua must be readable and commented.
- UTF-8 without BOM, LF endings, Windows-safe paths via `node:path`.
- Never edit versions by hand; the release workflow bumps them.

## Testing

Unit tests run with vitest from TypeScript sources, so `npm test` works before `npm run build`, except the CLI binary test and the cross-package imports, which read `dist/` through `node_modules/@tmhs/*`. Run `npm run build` first after changing `core`.
