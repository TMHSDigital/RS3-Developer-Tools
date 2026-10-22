-- Wiki Prices
--
-- Reference plugin for RS3 Developer Tools. It demonstrates the optional
-- httpAccess permission end to end: the base URL is declared under urls in
-- plugin.json, every request is built from Plugin.urls (a literal URL passed to
-- HTTPRequest is refused by the client and reported by preflight), the plugin
-- checks Plugin.HasPermission before every request and follows
-- Event.OptionalPermissionChanged so it keeps working when the user grants or
-- revokes the permission while the plugin is enabled.
--
-- Load it from the client console with:   pon wiki-prices
-- Reload after editing with:              prl wiki-prices

-- Reference names for event subscriptions, released in PluginShutdown.
local REFS = {
    permission = "wikiPrices.permissionChanged",
}

-- Build the window: a GroupBox on the plugin layer with a status line and a button.
local pluginLayer = ui.Interfaces:GetComponent(id.Component.TOPLEVEL_V2__PLUGIN_BUILD_LAYER_TOP)
if pluginLayer == nil then
    error("plugin layer is not available; is the game interface loaded?")
end
---@cast pluginLayer ui.ComponentCollection

local window = ui.GroupBox.new(pluginLayer)
window.stylesheetID = id.StyleSheet.GROUPBOX_DEFAULT
window:SetHeaderLayout(0, 0, 0, 0, ui.GroupBoxHeaderAlignMode.LEFT)
window:SetSize(320, 120)
window:SetPos(40, 40)

local status = ui.Text.new(window)
status:SetPos(0, 0)
status:SetSize(0, 0, 1.0, 0.5)
status.font = id.Font.MUSEO_SANS_15PT_REGULAR
status:AlignTo(ui.AlignMode.CENTRE)

local fetchButton = ui.Button.new(window)
fetchButton:SetPos(0, 0, 0.0, 0.5)
fetchButton:SetSize(0, 0, 1.0, 0.5)
fetchButton.label = "Fetch wiki site info"
fetchButton.stylesheetID = id.StyleSheet.BUTTON_DEFAULT

-- httpAccess is optional: the user can decline it or revoke it later. Check
-- before every request and keep the plugin useful without it.
local function hasHttpAccess()
    return Plugin.HasPermission(PluginPermissions.httpAccess)
end

local function showPermissionState()
    if hasHttpAccess() then
        status.content = "httpAccess granted; press the button"
    else
        status.content = "httpAccess is off; grant it in the plugin settings"
    end
end

-- One request in flight at a time; it is cancelled in PluginShutdown so a
-- reload never gets a callback into a destroyed window.
---@type HTTPRequest?
local pending = nil

-- The path is relative to the declared base URL. Only hosts listed under urls
-- can be reached, which is what makes the permission reviewable.
local function fetchSiteInfo()
    if not hasHttpAccess() then
        showPermissionState()
        return
    end
    if pending ~= nil then
        return
    end
    status.content = "fetching..."
    local request = HTTPRequest.new(Plugin.urls.wiki, "api.php?action=query&meta=siteinfo&format=json")
    pending = request
    request:Get(function(finished)
        pending = nil
        if finished.successful then
            status.content = formatStr("wiki answered {} with {} bytes", finished.responseCode, #finished.data)
        else
            status.content = formatStr("request failed: {}", finished.errorInfo)
        end
    end)
end
fetchButton:Subscribe(ui.Hook.ONBUTTONPRESSED, fetchSiteInfo)

-- Follow the user's decision at runtime.
local function onPermissionChanged(event)
    if event.permissionName == "httpAccess" then
        showPermissionState()
    end
end
Event.OptionalPermissionChanged.Subscribe(REFS.permission, onPermissionChanged)
showPermissionState()

-- The client calls PluginShutdown when the plugin is disabled or reloaded.
-- Release every subscription and component so a reload starts clean.
function PluginShutdown()
    Event.OptionalPermissionChanged.Unsubscribe(REFS.permission)
    fetchButton:Unsubscribe(ui.Hook.ONBUTTONPRESSED)
    if pending ~= nil then
        pending:Cancel()
        pending = nil
    end
    window:Destroy()
end
