-- Settings Panel
--
-- Reference plugin for RS3 Developer Tools. It demonstrates the settings icon:
-- "hasSettingsIcon": true in plugin.json gives the plugin an entry in the
-- client's plugin settings, and the client raises Event.SettingsLayerReady with
-- the component to build the panel into. The one setting here is a check box
-- whose state is stored in PersistentDB per character.
--
-- Load it from the client console with:   pon settings-panel
-- Reload after editing with:              prl settings-panel

-- Reference names for event subscriptions, released in PluginShutdown.
local REFS = {
    settingsReady = "settingsPanel.settingsLayerReady",
}

-- Every key this plugin writes starts with this prefix; the character name is
-- appended so the setting is remembered per character.
local STORAGE_PREFIX = "settingsPanel:showHints:"

-- Storage key for the current character, with a shared fallback on the lobby screen.
local function storageKeyForCurrentCharacter()
    local me = PlayerList.Self()
    if me ~= nil and me.isValid then
        return STORAGE_PREFIX .. me.displayName
    end
    return STORAGE_PREFIX .. "shared"
end

-- The check box lives only while the settings panel is open. It is rebuilt on
-- every SettingsLayerReady and released in PluginShutdown.
---@type ui.Check?
local hintsCheck = nil

-- Write the current check box state so it survives reloads and logouts.
local function saveHintsSetting()
    if hintsCheck ~= nil then
        PersistentDB:SetBool(storageKeyForCurrentCharacter(), hintsCheck.value)
    end
end

-- Release the check box and its hook; safe to call when nothing is built.
local function destroyHintsCheck()
    if hintsCheck ~= nil then
        hintsCheck:Unsubscribe(ui.Hook.ONBUTTONPRESSED)
        hintsCheck:Destroy()
        hintsCheck = nil
    end
end

-- Build the panel. event.component is the container the client reserves for
-- this plugin's settings; it accepts child components like any collection.
local function onSettingsLayerReady(event)
    local parent = event.component
    ---@cast parent ui.ComponentCollection
    destroyHintsCheck()

    local check = ui.Check.new(parent)
    check.label = "Show hints"
    check:SetPos(10, 10)
    check:SetSize(220, 24)
    -- GetBool returns nil until the setting has been written once; treat that as off.
    check.value = PersistentDB:GetBool(storageKeyForCurrentCharacter()) == true
    hintsCheck = check
    -- The press hook fires after the value has changed, so saving here stores the new state.
    -- Subscribed through hintsCheck so destroyHintsCheck releases the same receiver.
    hintsCheck:Subscribe(ui.Hook.ONBUTTONPRESSED, saveHintsSetting)
end

Event.SettingsLayerReady.Subscribe(REFS.settingsReady, onSettingsLayerReady)

-- The client calls PluginShutdown when the plugin is disabled or reloaded.
-- Unsubscribe and destroy here so a reload never leaves a stale panel behind.
function PluginShutdown()
    Event.SettingsLayerReady.Unsubscribe(REFS.settingsReady)
    destroyHintsCheck()
end
