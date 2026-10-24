# RS3 Developer Tools for VS Code and Cursor

RuneScape 3 plugin development without leaving the editor. The extension wraps the `rs3dev` command line:

- **Problems panel**: `rs3dev validate` and `rs3dev preflight` run on every save of `plugin.json` or a Lua file (`rs3.checkOnSave`). Each finding shows with its code; the code is a link to the documentation page, and "Open documentation" is offered as a quick fix.
- **Commands** (`Ctrl+Shift+P`, type `RS3`): Validate, Preflight, Run plugin tests, Sync into dev_plugins, Toggle watch, Package for mod.io, Doctor, Register the MCP server for Cursor.
- **Status bar**: the watch toggle. While on, `rs3dev watch` copies the plugin into the client's `dev_plugins` folder on every save; the console command to reload is printed in the output channel.
- **plugin.json schema**: completions and validation from the toolkit's JSON Schema.

## Requirements

The `rs3dev` CLI (`npm install -g @tmhs/rs3-devtools-cli`, Node.js 22 or later). `rs3.cliPath` can also be `npx -y @tmhs/rs3-devtools-cli` or the path to `packages/cli/dist/cli.js` in a checkout of the toolkit repository.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `rs3.cliPath` | `rs3dev` | How to run the CLI |
| `rs3.devPluginsRoot` | detected | The client's `dev_plugins` folder for sync and watch |
| `rs3.stubsDir` | installed package | Stubs folder for test and doctor |
| `rs3.maxLineLength` | CLI default | Preflight line length limit |
| `rs3.checkOnSave` | `true` | Run validate and preflight on save |

## Cursor

"RS3: Register the MCP server for Cursor" writes the `rs3-plugin` server into `.cursor/mcp.json` of the open folder (after confirmation, keeping other servers). The toolkit's Cursor rules and Claude Code skills come from `rs3dev init` or `rs3dev adopt`.

## Source

https://github.com/TMHSDigital/RS3-Developer-Tools, folder `packages/vscode`. MIT.
