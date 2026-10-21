# @tmhs/rs3-luals-stubs

Generated LuaLS `---@meta` stubs for the RuneScape Client API, one file per documentation page under `stubs/`, plus `index.json` (symbol index used by `rs3dev` and the MCP `api_lookup` tool) and `unresolved.md` (everything the generator could not state as a plain signature).

The stubs contain signatures only: class names, fields, parameter and return types, enumeration members, and a `@see` link to the exact documentation anchor. Descriptions are not included because the documentation is copyrighted by Jagex; follow the link.

## Use in a plugin workspace

Copy `luarc.template.json` to `.luarc.json` in your plugin folder and replace `${RS3_STUBS_DIR}` with the absolute path of this package's `stubs/` folder (forward slashes work on every platform). `rs3dev init` does this for you.

```json
{
  "runtime.version": "Lua 5.4",
  "workspace.library": ["C:/dev/RS3-Developer-Tools/packages/luals-stubs/stubs"],
  "workspace.checkThirdParty": false
}
```

Then install the Lua language server (`sumneko.lua` in VS Code or Cursor) and completions, hover signatures and type checks work for `ui.*`, `Event.*`, `PersistentDB`, `config.*`, `id.*`, `var.*` and the rest.

## Regenerating

```powershell
npm run build
npm run stubs:generate
```

Output is deterministic: the same documentation produces byte-identical files. The scheduled `stubs-regenerate.yml` workflow runs this weekly and commits any change to `main`.

## Layout

| Path | Content |
| --- | --- |
| `stubs/<section>/<page>.lua` | One meta file per documentation page |
| `stubs/_globals.lua` | `config.*`, `id.*`, `var.*` lookup tables |
| `stubs/_namespaces.lua` | `ui`, `game` and other namespace tables |
| `stubs/_extras.lua` | Aliases and optional global hooks taken from `overrides.json` |
| `stubs/_unresolved.lua` | `any` aliases for types the docs reference but never declare |
| `index.json` | Symbol index with kind, module, signature and docs URL |
| `unresolved.md` | Report of ambiguous API surface and every override applied |
