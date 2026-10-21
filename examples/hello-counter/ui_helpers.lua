-- UI helpers for Hello Counter.
--
-- Kept in a separate module to show how plugins split code across files:
-- require("ui_helpers") resolves relative to the plugin folder, without the
-- extension, and the returned table is cached for later calls.

local helpers = {}

-- Create a GroupBox window of the given size on the plugin layer and place it
-- a little way in from the top-left corner. Returns the GroupBox so callers can
-- add child components to it.
---@param width integer
---@param height integer
---@return ui.GroupBox
function helpers.createWindow(width, height)
    local pluginLayer = ui.Interfaces:GetComponent(id.Component.TOPLEVEL_V2__PLUGIN_BUILD_LAYER_TOP)
    if pluginLayer == nil then
        error("plugin layer is not available; is the game interface loaded?")
    end
    -- GetComponent returns the base component type; the plugin layer is a
    -- collection, so tell the language server which component type this is.
    ---@cast pluginLayer ui.ComponentCollection

    local groupBox = ui.GroupBox.new(pluginLayer)
    groupBox.stylesheetID = id.StyleSheet.GROUPBOX_DEFAULT
    groupBox:SetHeaderLayout(0, 0, 0, 0, ui.GroupBoxHeaderAlignMode.LEFT)
    groupBox:SetSize(width, height)
    groupBox:SetPos(40, 40)
    return groupBox
end

return helpers
