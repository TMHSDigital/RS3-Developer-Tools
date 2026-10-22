---
name: new-plugin
description: Create a new RS3 plugin folder with a valid manifest, a commented main.lua, LuaLS stubs wiring, and the first sync into dev_plugins.
triggers:
  - "create a new RS3 plugin"
  - "scaffold a RuneScape plugin"
  - "start a plugin called"
  - "set up plugin.json and main.lua"
  - "make a new plugin folder for the RS3 beta client"
standards-version: 1.10.1
---

# New plugin

Produce a plugin folder that the RS3 beta client can load with `pon <name>`, that passes `rs3dev validate` and `rs3dev preflight`, and that has LuaLS completions working through `.luarc.json`.

## When to use

- The developer asks for a new plugin, a fresh plugin folder, or a starting point for a feature.
- An existing folder has no `plugin.json` or `main.lua`.

## When NOT to use

- Adding a window or an event handler to an existing plugin: use `add-ui-window` or `add-event-handler`.
- Preparing a submission: use `preflight-and-package`.

## Steps

1. Choose the folder name. It is the identifier used by `pon`, `poff`, `prl`; use lowercase words joined with hyphens and no spaces.
2. Decide the permissions. Default to none. Add `httpAccess`, `chatAccess` or `trackingAccess` as optional permissions only when the feature needs them, and plan the `Plugin.HasPermission` fallback.
3. Run the scaffold from the parent folder:

```powershell
rs3dev init my-plugin --permissions chatAccess --email <address>
```

   `<address>` is the address users should write to; `rs3dev package` refuses placeholder domains such as `example.com`, so leave the flag off only if step 4 sets it. Add `--prettyui` when the plugin builds on the PrettyUI library, and `--no-agent-files` to skip the Cursor rules and Claude skills copy. With the MCP server, call `plugin_scaffold` with the same options.
4. Open `plugin.json` and set `name` and `version`, and confirm `contactEmailAddress` is a real address (the scaffold writes `change-me@example.com` when `--email` is omitted).
5. Read `main.lua`. Keep the structure: constants and reference names at the top, helpers, UI construction, event subscriptions, then `PluginShutdown`.
6. Check the editor picks up completions: hovering `PersistentDB` or `ui.Button` should show a signature and a `@see` link. If not, confirm `.luarc.json` points at the `stubs` folder of `@tmhs/rs3-luals-stubs`.
7. Sync and load:

```powershell
rs3dev sync my-plugin
```

   In the client console (ALT+`): `prf`, then `pon my-plugin`. After edits: `prl my-plugin`. Use `rs3dev watch my-plugin` to sync on save.
8. Run `rs3dev validate my-plugin` and `rs3dev preflight my-plugin`; both must report zero errors before the first commit.

## Examples

Request: "start a plugin called loot-tally that counts drops and shows them in a window"

Result: `loot-tally/plugin.json` with no permissions, `loot-tally/main.lua` with a GroupBox, a label, an `Event.ObjStackEntityAdded` subscription whose reference name is `lootTally.objStackAdded`, PersistentDB keys prefixed `lootTally:` and suffixed with the character name, and a `PluginShutdown` that unsubscribes and destroys the window.

## Reference

- Plugin structure and manifest: https://developer.runescape.com/rs/structure.html
- Developer environment and console commands: https://developer.runescape.com/rs/tutorial/1helloworld.html
- Example in this repository: `examples/hello-counter`
