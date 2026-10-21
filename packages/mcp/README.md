# @tmhs/rs3-plugin-mcp

stdio MCP server for RuneScape 3 plugin development.

```powershell
rs3-plugin-mcp --workspace C:\dev\my-plugins
```

The workspace defaults to `RS3_WORKSPACE` or the current directory. Read tools accept paths inside the workspace or the client's `dev_plugins` root; write tools refuse anything else. Documentation is fetched live from developer.runescape.com with an ETag cache under `%LOCALAPPDATA%\rs3-devtools\cache`; nothing from the docs or from other developers' plugins is indexed.

| Tool | Writes | Notes |
| --- | --- | --- |
| `docs_search` | no | symbol and page search over the generated stub index |
| `docs_get` | no | page text, optional `section`, `maxChars` |
| `api_lookup` | no | signature, stub file, docs URL |
| `manifest_validate` | no | schema plus folder checks |
| `guidelines_preflight` | no | sandbox, permissions, URLs, readability |
| `plugin_scaffold` | yes | never overwrites existing files |
| `devplugins_sync` | yes | `confirm=true` required; `dry_run=true` previews |
| `package_zip` | yes | writes under `<workspace>/dist` unless `outFile` is given |

Configuration examples for Claude Code and Cursor are in `examples/`.
