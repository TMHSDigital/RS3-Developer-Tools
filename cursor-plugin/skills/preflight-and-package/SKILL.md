---
name: preflight-and-package
description: Run validate and preflight on an RS3 plugin, fix every error, build the mod.io zip, and walk through the manual submission checklist.
triggers:
  - "prepare the plugin for submission"
  - "package the plugin for mod.io"
  - "run preflight on the plugin"
  - "check the plugin against the guidelines"
  - "build the plugin zip"
standards-version: 1.10.1
---

# Preflight and package

Get a plugin from "works in the beta client" to "ready to upload": schema-valid manifest, no sandbox or permission violations, readable code, and a zip with `plugin.json` and `main.lua` at the archive root.

## When to use

- Before every submission or update on mod.io.
- After a round of changes, as the last step before committing.

## When NOT to use

- Scaffolding or feature work: use the other skills first.
- Uploading: there is no API upload for RuneScape plugins; the upload is a manual step on mod.io.

## Steps

1. Validate the manifest and folder:

```powershell
rs3dev validate my-plugin
```

   Fix every error. Common ones: missing `contactEmailAddress`, a `require` path that does not match a file, a UTF-8 BOM at the top of `main.lua`.
2. Run the static checks:

```powershell
rs3dev preflight my-plugin
```

   Errors (exit code 1) are rejection reasons: `os`, `io`, `debug`, `load`, `loadstring`, `dofile` use (also through `_G`); `Chat` or `Event.ChatMessage` without `chatAccess`; `HTTPRequest` without `httpAccess`; a URL literal passed to `HTTPRequest` whose host is not in `urls`; `Player.GetTrackingID` without `trackingAccess`; `shutdown-missing` (a subscription exists but no `PluginShutdown`). Warnings cover `subscribe-without-unsubscribe`, `per-tick-scan` (a `*List.All`, `*List.Find` or `GetAll` call inside an `Event.Logic` or `Event.Draw` handler without a counter), long lines, low comment ratio, encoded strings and `string.char` chains; fix them too, moderators read the code. `component-not-destroyed` is a note for a top-level GroupBox or Layer never passed to `:Destroy()`. A reviewed exception goes in `rs3dev.json` (`"preflight": { "ignore": ["low-comment-ratio"] }`) or on the line above the code as `-- rs3dev-ignore <code>`; `rs3dev preflight --format github` prints workflow annotations for a plugin repository's own CI.
3. Read every finding's `see` link before changing code; the documentation page states the rule.
4. Re-run until both commands report zero errors. With the MCP server, `manifest_validate` and `guidelines_preflight` return the same findings as JSON.
5. Test in the client one last time from a clean reload: `rs3dev sync my-plugin`, then `prl my-plugin`, exercise every feature, and check `PluginShutdown` leaves nothing behind (`poff my-plugin` removes the window).
6. Build the archive:

```powershell
rs3dev package my-plugin
```

   The zip contains the plugin files at the root and excludes dotfiles, `AGENTS.md`, `.luarc.json`, `rs3dev.json`, `node_modules`, OS and editor junk and anything listed in `.rs3ignore`. The command prints the largest entries, a size warning above 10 MB, and the submission checklist. Inspect the archive with `rs3dev package --verify <zip> --list` before uploading; it checks the root layout, the manifest, leftover development files and every `require` target inside the zip.
7. Upload manually on mod.io following https://developer.runescape.com/rs/submission/process.html. Write the description per https://developer.runescape.com/rs/submission/example.html and confirm the legal requirements on https://developer.runescape.com/rs/submission/index.html.
8. Bump `version` in `plugin.json` for every resubmission.

## Examples

Request: "preflight says url-outside-manifest for https://prices.example.net"

Result: the finding is an error only when the literal is passed to `HTTPRequest`; a URL that is only shown or logged is a warning. Either add `"prices": "https://prices.example.net/"` to `urls` and build the request with `HTTPRequest.new(Plugin.urls.prices, path)`, or remove the literal. Then re-run preflight.

## Reference

- Guidelines and AI policy: https://developer.runescape.com/rs/submission/guidelines.html
- Submission process: https://developer.runescape.com/rs/submission/process.html
