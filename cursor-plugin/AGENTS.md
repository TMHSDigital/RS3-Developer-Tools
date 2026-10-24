<!-- standards-version: 1.10.1 -->

# AGENTS.md

This file tells AI coding agents how to work inside an official RuneScape 3 plugin folder. It is installed by `rs3dev init` from RS3 Developer Tools (https://github.com/TMHSDigital/RS3-Developer-Tools).

## What this folder is

An RS3 plugin: Lua 5.4.8 that the RuneScape beta client runs against the RuneScape Client API.

- `plugin.json` is the manifest (name, version, contactEmailAddress, dependencies, permissions, urls). Schema: `https://raw.githubusercontent.com/TMHSDigital/RS3-Developer-Tools/main/packages/schema/plugin.schema.json`.
- `main.lua` runs when the plugin is enabled; `function PluginShutdown()` runs when it is disabled or reloaded.
- Other `.lua` files load with `require("folder/file")`, relative to this folder, no extension.
- `resources/` holds sprites and audio the plugin ships.
- `.luarc.json` points the Lua language server at generated API stubs. Hover any API symbol for its signature and a `@see` docs link. If every API symbol shows as undefined, the stubs moved: run `rs3dev luarc .` (or `rs3dev luarc . --vendor` to copy them into `.rs3/stubs`); `rs3dev validate .` reports this as `luarc-stale`.
- `.cursor/rules/*.mdc` and `.claude/skills/*/SKILL.md` are the conventions and task guides; they are development files and are excluded from the packaged zip.

## Commands

```powershell
rs3dev validate .      # schema and folder checks
rs3dev preflight .     # sandbox, permission and readability checks; exit 1 on errors
rs3dev test .          # run tests/*.lua outside the client against API fakes (see the add-tests skill)
rs3dev sync .          # copy into the client's dev_plugins folder, then run prl <name> in the console
rs3dev watch .         # sync on save
rs3dev package .       # zip for manual upload to mod.io
```

Client console (ALT+`): `prf` refresh list, `plist` list, `pon <name>`, `poff <name>`, `prl <name>` reload.

## Non-negotiable rules

- Never use `os`, `io`, `debug`, `load`, `loadstring` or `dofile`; the sandbox does not provide them and moderators reject their presence.
- Declare `httpAccess`, `chatAccess`, `trackingAccess` in `plugin.json` before using the gated API; gate optional permissions with `Plugin.HasPermission`.
- Every `Subscribe` has a matching `Unsubscribe` in `PluginShutdown`; every created component is destroyed there.
- PersistentDB keys include the character's display name when the value is per character.
- Code stays readable: local names, comments explaining intent, no minification, no encoded strings, no generated code the developer has not read.
- `contactEmailAddress` must be a real address; it is a legal requirement.

## AI policy and copyright

- Only this folder and pages fetched live from developer.runescape.com are inputs. Never read other developers' plugins (mod.io downloads, the client's `plugins/` folder, third-party repositories).
- Link documentation, do not paste it. The RuneScape Client API docs are copyright Jagex.
- Every generated line is a draft until the developer has read it and tested it in the client. Jagex guidelines: https://developer.runescape.com/rs/submission/guidelines.html

## Distribution

Upload is manual on mod.io with Jagex moderation; there is no API upload. Bump `version` for each resubmission.
