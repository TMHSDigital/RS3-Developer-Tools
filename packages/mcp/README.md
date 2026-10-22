# @tmhs/rs3-plugin-mcp

stdio MCP server for RuneScape 3 plugin development.

```powershell
rs3-plugin-mcp --workspace C:\dev\my-plugins
```

The workspace defaults to `RS3_WORKSPACE` or the current directory. Read tools accept paths inside the workspace or the client's `dev_plugins` root; write tools refuse anything else. Documentation is fetched live from developer.runescape.com with an ETag cache under `%LOCALAPPDATA%\rs3-devtools\cache`; the only index of it is the per-user one `docs_index` builds in that same cache, and other developers' plugins are never read.

The server sends `instructions` in the initialise handshake (the non-negotiable rules and the AI policy from `cursor-plugin/AGENTS.md`), so a client without the Cursor rules or Claude Code skills still gets them. Every tool carries MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`; see `src/annotations.ts`). Three prompts mirror the skills: `new_plugin` (name, permissions), `fix_preflight` (path) and `prepare_submission` (path). Three resources expose the stubs: `rs3://stubs/index.json`, `rs3://stubs/unresolved.md` and `rs3://stubs/modules/{+id}` (one stub file per documentation page, for example `rs3://stubs/modules/core/persistentdb`).

| Tool | Writes | Notes |
| --- | --- | --- |
| `docs_search` | no | symbol and page search over the stub index; page sections by words after `docs_index` |
| `docs_index` | user cache only | builds the full-text index under `%LOCALAPPDATA%\rs3-devtools\cache\docs-index`; never committed |
| `docs_get` | no | page text, optional `section` (anchor or heading), `maxChars` |
| `api_lookup` | no | signature, stub file, docs URL |
| `manifest_validate` | no | schema plus folder checks |
| `guidelines_preflight` | no | sandbox, permissions, URLs, readability |
| `plugin_scaffold` | yes | never overwrites existing files |
| `devplugins_sync` | yes | `confirm=true` required; `dry_run=true` returns the files a real sync would copy and remove |
| `package_zip` | yes | writes under `<workspace>/dist` unless `outFile` is given |

Configuration examples for Claude Code and Cursor are in `examples/`. They carry no `RS3_DEV_PLUGINS_DIR` so the same file works on every platform: the `dev_plugins` root is detected from the client's `*.jcache` files. Set the variable only when the client is installed somewhere unusual, and point it at the folder itself (Windows default `C:\ProgramData\Jagex\RuneScape-BETA\dev_plugins`; on macOS or Linux use the equivalent path inside your client install). A value that does not exist or is not named `dev_plugins` is rejected by `devplugins_sync` rather than created.
