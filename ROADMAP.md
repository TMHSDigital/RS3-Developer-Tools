<!-- standards-version: 1.10.1 -->

# Roadmap

**Current:** v0.1.0

## RS3 Developer Tools

### v0.1.x - Foundation

- [x] Stubs generator and generated LuaLS stubs
- [x] plugin.json schema
- [x] rs3dev CLI (init, validate, preflight, sync, watch, package)
- [x] MCP server with 8 tools
- [x] Cursor rules and Claude Code skills
- [x] Reference plugin and LuaLS check in CI
- [ ] Publish packages to npm and switch the README install to `npm install -g @tmhs/rs3-devtools-cli`
- [ ] Register in the Developer-Tools-Directory catalog

### v0.2.0 - Deeper checks

- [x] Preflight: detect per-tick API list scans inside `Event.Logic` and `Event.Draw`
- [x] Preflight: verify every `Subscribe` has a matching `Unsubscribe` in `PluginShutdown`
- [x] Stubs: resolve the remaining `_unresolved.lua` aliases through overrides where the docs state the type in prose
- [x] `rs3dev doctor`: report client folder, LuaLS binary, and cache state
- [ ] Skill: migrate-ui-to-prettyui

### v1.0.0 - Stable

- [ ] Stable stub naming and index format for downstream tools
- [ ] Full test matrix including a sample for every MCP tool fixture
- [x] Documentation site with per-tool pages and a searchable API symbol index
