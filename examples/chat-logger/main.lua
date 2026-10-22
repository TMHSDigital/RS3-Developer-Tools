-- Chat Logger
--
-- Reference plugin for RS3 Developer Tools. It demonstrates the optional
-- chatAccess permission: Event.ChatMessage is only delivered when the user has
-- granted it, so the plugin checks Plugin.HasPermission before subscribing,
-- follows Event.OptionalPermissionChanged when the user grants or revokes it
-- later, and stays useful (it still shows its window) without it.
--
-- It counts messages per chat type and keeps nothing else: other players' text
-- and names are never stored, which is what the guidelines expect of a plugin
-- that reads chat.
--
-- Load it from the client console with:   pon chat-logger
-- Reload after editing with:              prl chat-logger

-- Reference names for event subscriptions, released in PluginShutdown.
local REFS = {
    chat = "chatLogger.chatMessage",
    permission = "chatLogger.permissionChanged",
}

-- Counts per chat type since the plugin was enabled.
local counts = { public = 0, friends = 0, other = 0 }

-- Build the window: a GroupBox on the plugin layer with one label.
local pluginLayer = ui.Interfaces:GetComponent(id.Component.TOPLEVEL_V2__PLUGIN_BUILD_LAYER_TOP)
if pluginLayer == nil then
    error("plugin layer is not available; is the game interface loaded?")
end
---@cast pluginLayer ui.ComponentCollection

local window = ui.GroupBox.new(pluginLayer)
window.stylesheetID = id.StyleSheet.GROUPBOX_DEFAULT
window:SetHeaderLayout(0, 0, 0, 0, ui.GroupBoxHeaderAlignMode.LEFT)
window:SetSize(300, 80)
window:SetPos(40, 40)

local label = ui.Text.new(window)
label:SetPos(0, 0)
label:SetSize(0, 0, 1.0, 1.0)
label.font = id.Font.MUSEO_SANS_15PT_REGULAR
label:AlignTo(ui.AlignMode.CENTRE)

-- chatAccess is optional: the user can decline it or revoke it later.
local function hasChatAccess()
    return Plugin.HasPermission(PluginPermissions.chatAccess)
end

local function render()
    if hasChatAccess() then
        label.content = formatStr("public {}  friends {}  other {}", counts.public, counts.friends, counts.other)
    else
        label.content = "chatAccess is off; grant it in the plugin settings to count messages"
    end
end

-- Only the chat type is inspected. event.chatMessage and the sender fields are
-- deliberately not read, so no text from other players is kept anywhere.
local function onChatMessage(event)
    if event.chatType == ChatType.PUBLIC then
        counts.public = counts.public + 1
    elseif event.chatType == ChatType.FRIEND_CHAT then
        counts.friends = counts.friends + 1
    else
        counts.other = counts.other + 1
    end
    render()
end

-- Subscribe only while the permission is granted; the client would not deliver
-- the event otherwise, and a dangling subscription is easy to forget.
local subscribed = false
local function subscribeToChat()
    if hasChatAccess() and not subscribed then
        Event.ChatMessage.Subscribe(REFS.chat, onChatMessage)
        subscribed = true
    end
end
local function unsubscribeFromChat()
    if subscribed then
        Event.ChatMessage.Unsubscribe(REFS.chat)
        subscribed = false
    end
end

-- Follow the user's decision at runtime.
local function onPermissionChanged(event)
    if event.permissionName ~= "chatAccess" then
        return
    end
    if event.enabled then
        subscribeToChat()
    else
        unsubscribeFromChat()
    end
    render()
end

subscribeToChat()
Event.OptionalPermissionChanged.Subscribe(REFS.permission, onPermissionChanged)
render()

-- The client calls PluginShutdown when the plugin is disabled or reloaded.
-- Release every subscription and the window so a reload starts clean.
function PluginShutdown()
    unsubscribeFromChat()
    Event.OptionalPermissionChanged.Unsubscribe(REFS.permission)
    window:Destroy()
end
