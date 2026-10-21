---
name: add-ui-window
description: Add a GroupBox window with labels, buttons and other components to an RS3 plugin, wired to the plugin layer and destroyed on shutdown.
triggers:
  - "add a window to the plugin"
  - "create a GroupBox with a button"
  - "show a label in the game UI"
  - "build a settings panel for the plugin"
  - "add a UI component"
standards-version: 1.10.1
---

# Add a UI window

Create plugin UI with the `ui.*` components: a `ui.GroupBox` (or `ui.Layer`) parented to the plugin layer, child components positioned with `SetPos` and `SetSize`, built-in stylesheets from `id.StyleSheet`, and hooks subscribed through `component:Subscribe(ui.Hook.<HOOK>, ...)`.

## When to use

- The plugin needs a visible window, label, button, checkbox, slider, list or input field.
- An existing window needs another component or a layout change.

## When NOT to use

- Reacting to game state without UI: use `add-event-handler`.
- Drawing shapes in the world: see https://developer.runescape.com/rs/game/shapes.html instead.

## Steps

1. Get the parent. Plugin UI attaches to the plugin build layer:

```lua
local layer = ui.Interfaces:GetComponent(id.Component.TOPLEVEL_V2__PLUGIN_BUILD_LAYER_TOP)
if layer == nil then
    error("plugin layer not available yet")
end
---@cast layer ui.ComponentCollection
```

   For the settings panel or ribbon content, set `hasSettingsIcon` or `hasRibbonIcon` in `plugin.json` and build inside `Event.SettingsLayerReady` or `Event.ContentLayerReady`, whose payload gives the empty parent component.
2. Create the container and style it:

```lua
local window = ui.GroupBox.new(layer)
window.stylesheetID = id.StyleSheet.GROUPBOX_DEFAULT
window:SetHeaderLayout(0, 0, 0, 0, ui.GroupBoxHeaderAlignMode.LEFT)
window:SetSize(260, 140)
window:SetPos(40, 40)
```

3. Add children. `SetPos(x, y, parentPercentX, parentPercentY)` and `SetSize(w, h, parentPercentW, parentPercentH)` mix absolute units with fractions of the parent:

```lua
local title = ui.Text.new(window)
title:SetSize(0, 0, 1.0, 0.4)
title.font = id.Font.MUSEO_SANS_15PT_REGULAR
title:AlignTo(ui.AlignMode.CENTRE)
title.content = "Loot tally"

local button = ui.Button.new(window)
button:SetPos(0, 0, 0.0, 0.5)
button:SetSize(0, 0, 1.0, 0.5)
button.label = "Reset"
button.stylesheetID = id.StyleSheet.BUTTON_DEFAULT
```

4. Wire behaviour with a named hook id so it can be removed:

```lua
button:Subscribe(ui.Hook.ONBUTTONPRESSED, "lootTally.reset", function()
    resetTally()
end)
```

5. Release in `PluginShutdown`: unsubscribe hooks, then `window:Destroy()` (children go with it).
6. Use the recommended built-in styles (`BUTTON_DEFAULT`, `CHECKBOX_DEFAULT`, `INPUT_DEFAULT`, `GROUPBOX_DEFAULT`, `SLIDER_DEFAULT`) before creating custom stylesheets.
7. Reload with `prl <name>` and check the window appears once; a second copy means `PluginShutdown` did not destroy the previous one.

## Examples

Request: "add a checkbox that toggles NPC logging"

Result: a `ui.Check` child of the existing GroupBox with `stylesheetID = id.StyleSheet.CHECKBOX_DEFAULT`, an `ONBUTTONPRESSED` hook that flips a local `loggingEnabled` flag and saves it with `PersistentDB:SetBool`, and matching `Unsubscribe` in `PluginShutdown`.

## Reference

- Component base: https://developer.runescape.com/rs/ui/component.html
- Layout components: https://developer.runescape.com/rs/ui/layout_components/group_box.html
- Stylesheets: https://developer.runescape.com/rs/ui/stylesheets.html
- Tutorial: https://developer.runescape.com/rs/tutorial/2simpleui.html
