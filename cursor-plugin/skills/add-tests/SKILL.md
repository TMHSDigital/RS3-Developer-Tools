---
name: add-tests
description: Write Lua tests for an RS3 plugin that run outside the client with rs3dev test, against the API fakes generated from the stubs, covering load, clicks, events, persistence and PluginShutdown.
triggers:
  - "add tests to the plugin"
  - "test the plugin without the client"
  - "write a test for the button"
  - "check PluginShutdown unsubscribes everything"
  - "run the plugin tests"
  - "does this still work after the refactor"
standards-version: 1.10.1
---

# Add tests

Put `tests/<topic>_test.lua` files beside `main.lua` and run them with `rs3dev test .`. No client, no login: the plugin runs against fakes of every API table, class, enum and event, built from the same stubs the editor uses.

## When to use

- A plugin has logic worth keeping correct across refactors: counters, settings, key names, event handlers, request flows.
- A bug was found in the client and should not come back.
- Before `rs3dev package`: the submission checklist is easier to defend when `rs3dev test` is green.

## When NOT to use

- Visual layout, stylesheets, fonts or anything only the client renders: check those with `rs3dev watch` and `prl <name>` in the client.
- Timing against the real game loop or real HTTP responses: the fakes return typed defaults, not game data.

## How the harness works

`local T = require("rs3_test")` gives one object:

| Call | What it does |
| --- | --- |
| `T.test(name, fn)` | Registers a test. Each test starts from a clean state: empty PersistentDB, no components, no subscriptions, no `PluginShutdown`. |
| `T.load()` | Runs `main.lua` the way the client does on load. Call it inside the test after any setup. |
| `T.shutdown()`, `T.reload()` | Calls `PluginShutdown`; `reload` then loads again while keeping PersistentDB, like `prl`. |
| `T.find("ui.Button")`, `T.find_all(class)` | Live components by class (`ui.GroupBox`, `ui.Text`, `ui.Check`...). Components keep `parent`, `children`, `x`, `y`, `width`, `height`, `destroyed` and every property the plugin set. |
| `T.press(component, hook?)` | Fires a component hook; `ui.Hook.ONBUTTONPRESSED` by default. |
| `T.emit("NPCEntityAdded", { npcEntity = { displayName = "Goblin" } })` | Emits a client event; missing payload fields take their documented defaults. |
| `T.subscriptions()`, `T.hooks(component)` | What is still subscribed, for shutdown tests. |
| `T.db`, `T.logs`, `T.player`, `T.permissions`, `T.root` | The PersistentDB store, `log()` lines, what `PlayerList.Self()` returns, `Plugin.HasPermission` answers (from `plugin.json`), the plugin layer. |
| `T.calls("PersistentDB:SetInt")`, `T.assert.called(name, times?)` | Recorded API calls by qualified name. |
| `T.assert.equals`, `not_equals`, `is_true`, `is_false`, `is_nil`, `not_nil`, `contains`, `matches`, `errors`, `called`, `not_called` | Assertions; the message names the test line. |

Anything the fakes return is a typed default: integers are `0`, strings `""`, booleans `false`, optional values `nil`, objects are fake instances whose fields default the same way. Set what a test needs before `T.load()` (`T.player.displayName = "Zezima"`, `T.db["key"] = 3`).

## Steps

1. Create `tests/` beside `main.lua` (the folder never ships; `rs3dev package` and `sync` skip it).
2. Start with the lifecycle test every plugin should have:

```lua
local T = require("rs3_test")

T.test("loads and shuts down cleanly", function()
    T.load()
    T.assert.not_nil(T.find("ui.GroupBox"), "the window exists")
    T.shutdown()
    T.assert.equals({}, T.subscriptions(), "every event was unsubscribed")
    T.assert.is_nil(T.find("ui.GroupBox"), "the window was destroyed")
end)
```

3. Add one test per behaviour, named after the behaviour in plain words. Drive the plugin through the same entry points the client uses: `T.press` for buttons, `T.emit` for events, `T.reload` for persistence.

```lua
T.test("a click saves the count per character", function()
    T.load()
    T.press(T.find("ui.Button"))
    T.assert.equals(1, T.db["myPlugin:clicks:Tester"])
    T.assert.called("PersistentDB:SetInt", 1)
end)
```

4. Run `rs3dev test .` (or `rs3dev test <plugin folder>`); exit code 1 means a failure. The bundled Lua 5.4 runs in WebAssembly; pass `--lua <path>` or set `RS3_LUA` to use a native interpreter.
5. Keep the LuaLS check green too: tests are plain Lua, `rs3dev preflight` ignores `tests/` and `spec/`.

## Examples

Request: "make sure the hints checkbox remembers its state"

Result: `tests/settings_test.lua` that emits `SettingsLayerReady` with a fake layer, finds the `ui.Check`, presses it, asserts `T.db["settingsPanel:hints:Tester"] == true`, reloads and asserts the check's `value` is `true` again.

## Reference

- Reference tests: `examples/hello-counter/tests/counter_test.lua` in the toolkit repository
- Runtime source: `test-runtime/rs3_test.lua` in `@tmhs/rs3-luals-stubs`; fakes: `fakes/rs3_api_fakes.lua` (generated, do not edit)
- Lifecycle contract: https://developer.runescape.com/rs/structure.html
