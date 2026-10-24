-- Tests for Chat Logger, run outside the client with:   rs3dev test .
--
-- chatAccess comes from plugin.json (optionalPermissions), so Plugin.HasPermission
-- answers true unless a test clears T.permissions.chatAccess before loading.

local T = require("rs3_test")

local function labelText()
    return T.find("ui.Text").content
end

T.test("subscribes to chat while the permission is granted", function()
    T.load()
    T.assert.equals({
        { event = "ChatMessage", ref = "chatLogger.chatMessage" },
        { event = "OptionalPermissionChanged", ref = "chatLogger.permissionChanged" },
    }, T.subscriptions())
    T.assert.equals("public 0  friends 0  other 0", labelText())
end)

T.test("counts messages by chat type without reading their text", function()
    T.load()
    T.emit("ChatMessage", { chatType = ChatType.PUBLIC, chatMessage = "never read" })
    T.emit("ChatMessage", { chatType = ChatType.PUBLIC })
    T.emit("ChatMessage", { chatType = ChatType.FRIEND_CHAT })
    T.emit("ChatMessage", { chatType = ChatType.PRIVATE_INCOMING })
    T.assert.equals("public 2  friends 1  other 1", labelText())
end)

T.test("stays quiet without chatAccess and follows the permission at runtime", function()
    T.permissions.chatAccess = nil
    T.load()
    T.assert.equals({ { event = "OptionalPermissionChanged", ref = "chatLogger.permissionChanged" } }, T.subscriptions())
    T.assert.matches(labelText(), "^chatAccess is off")
    T.permissions.chatAccess = true
    T.emit("OptionalPermissionChanged", { permissionName = "chatAccess", enabled = true })
    T.assert.equals(2, #T.subscriptions(), "chat is subscribed once the permission is granted")
    T.emit("OptionalPermissionChanged", { permissionName = "chatAccess", enabled = false })
    T.assert.equals(1, #T.subscriptions(), "and released when it is revoked")
end)

T.test("PluginShutdown releases every subscription and the window", function()
    T.load()
    T.shutdown()
    T.assert.equals({}, T.subscriptions())
    T.assert.is_nil(T.find("ui.GroupBox"))
end)
