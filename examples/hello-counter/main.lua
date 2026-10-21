-- Hello Counter
--
-- Reference plugin for RS3 Developer Tools. It shows the three things most
-- plugins need: a small window built from UI components, a value that survives
-- reloads through PersistentDB, and a subscription to a game event.
--
-- Load it from the client console with:   pon hello-counter
-- Reload after editing with:              prl hello-counter

local ui_helpers = require("ui_helpers")

-- A single prefix keeps every key this plugin writes grouped together, and the
-- character name is appended so counts are kept per character.
local STORAGE_PREFIX = "helloCounter:clicks:"

-- Reference names for event subscriptions. Keeping them in one place makes it
-- obvious what to unsubscribe when the plugin shuts down.
local EVENT_NPC_ADDED = "helloCounter.npcAdded"

-- Build the storage key for the current character. Falls back to a shared key
-- when no character is logged in yet (for example while on the lobby screen).
local function storageKeyForCurrentCharacter()
    local me = PlayerList.Self()
    if me ~= nil and me.isValid then
        return STORAGE_PREFIX .. me.displayName
    end
    return STORAGE_PREFIX .. "shared"
end

-- Read the saved click count, defaulting to zero the first time the plugin runs.
local function loadClickCount()
    local saved = PersistentDB:GetInt(storageKeyForCurrentCharacter())
    if saved == nil then
        return 0
    end
    return saved
end

local clickCount = loadClickCount()

-- Create the window: a GroupBox attached to the plugin layer the client
-- provides, containing a label and a button.
local window = ui_helpers.createWindow(250, 120)

local counterLabel = ui.Text.new(window)
counterLabel:SetPos(0, 0)
counterLabel:SetSize(0, 0, 1.0, 0.5)
counterLabel.font = id.Font.MUSEO_SANS_15PT_REGULAR
counterLabel:AlignTo(ui.AlignMode.CENTRE)

local function refreshLabel()
    counterLabel.content = formatStr("Clicks: {}", clickCount)
end
refreshLabel()

local clickButton = ui.Button.new(window)
clickButton:SetPos(0, 0, 0.0, 0.5)
clickButton:SetSize(0, 0, 1.0, 0.5)
clickButton.label = "Click me"
clickButton.stylesheetID = id.StyleSheet.BUTTON_DEFAULT

-- Every press increments the counter and saves it immediately, so a crash or a
-- hard client exit never loses more than nothing.
local function onButtonPressed()
    clickCount = clickCount + 1
    PersistentDB:SetInt(storageKeyForCurrentCharacter(), clickCount)
    refreshLabel()
end
clickButton:Subscribe(ui.Hook.ONBUTTONPRESSED, onButtonPressed)

-- Log every NPC that enters the scene. The payload gives the entity directly.
local function onNpcAdded(event)
    log("NPC appeared: " .. event.npcEntity.displayName)
end
Event.NPCEntityAdded.Subscribe(EVENT_NPC_ADDED, onNpcAdded)

-- The client calls PluginShutdown when the plugin is disabled or reloaded.
-- Unsubscribe here so a reload never leaves a stale handler behind.
function PluginShutdown()
    Event.NPCEntityAdded.Unsubscribe(EVENT_NPC_ADDED)
    clickButton:Unsubscribe(ui.Hook.ONBUTTONPRESSED)
    window:Destroy()
end
