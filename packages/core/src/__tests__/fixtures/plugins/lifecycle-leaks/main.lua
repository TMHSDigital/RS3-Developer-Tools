-- Lifecycle fixture: has a PluginShutdown, but leaks in four ways that the
-- lifecycle checks must point out (and one correct subscription that must not).
local REFS = { npcAdded = "leaks.npcAdded", logic = "leaks.logic", draw = "leaks.draw" }

local pluginLayer = ui.Interfaces:GetComponent(id.Component.TOPLEVEL_V2__PLUGIN_BUILD_LAYER_TOP)
---@cast pluginLayer ui.ComponentCollection

-- Destroyed in PluginShutdown: fine.
local window = ui.GroupBox.new(pluginLayer)
-- Never destroyed: component-not-destroyed.
local overlay = ui.Layer.new(pluginLayer)
-- A child of the destroyed window: fine.
local panel = ui.GroupBox.new(window)
local button = ui.Button.new(window)

local function onNpcAdded(event)
    log(event.npcEntity.displayName)
end

-- Scans the NPC list on every tick with no counter: per-tick-scan.
local function onLogic()
    local all = NPCList.All()
    log(#all)
end

-- Guarded by a counter: fine.
local ticks = 0
Event.Draw.Subscribe(REFS.draw, function()
    ticks = ticks + 1
    if ticks % 50 == 0 then
        log(#PlayerList.All())
    end
end)

Event.NPCEntityAdded.Subscribe(REFS.npcAdded, onNpcAdded)
Event.Logic.Subscribe(REFS.logic, onLogic)
-- Hook never unsubscribed: subscribe-without-unsubscribe.
button:Subscribe(ui.Hook.ONBUTTONPRESSED, function() end)

function PluginShutdown()
    Event.NPCEntityAdded.Unsubscribe(REFS.npcAdded)
    -- REFS.logic and REFS.draw are never unsubscribed: subscribe-without-unsubscribe.
    window:Destroy()
    print(panel, overlay)
end
