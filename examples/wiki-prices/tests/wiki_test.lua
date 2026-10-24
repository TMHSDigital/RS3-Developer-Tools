-- Tests for Wiki Prices, run outside the client with:   rs3dev test .
--
-- HTTPRequest is a fake: request:Get(callback) records the call and returns
-- nothing, so a test completes the request by calling the recorded callback
-- with the shape the client documents (successful, responseCode, data).

local T = require("rs3_test")

local function statusText()
    return T.find("ui.Text").content
end

T.test("tells the user when httpAccess is granted", function()
    T.load()
    T.assert.equals("httpAccess granted; press the button", statusText())
    T.assert.not_nil(T.find("ui.GroupBox"))
    T.assert.not_nil(T.find("ui.Button"))
end)

T.test("without httpAccess the button explains instead of requesting", function()
    T.permissions.httpAccess = nil
    T.load()
    T.assert.equals("httpAccess is off; grant it in the plugin settings", statusText())
    T.press(T.find("ui.Button"))
    T.assert.not_called("HTTPRequest:Get")
end)

T.test("a press sends one request against the declared wiki URL and shows the answer", function()
    T.load()
    T.press(T.find("ui.Button"))
    T.assert.equals("fetching...", statusText())
    T.assert.called("HTTPRequest.new", 1)
    T.assert.equals(Plugin.urls.wiki, T.calls("HTTPRequest.new")[1].args[1], "the base URL comes from Plugin.urls")
    T.assert.called("HTTPRequest:Get", 1)
    -- A second press while the first request is pending does nothing.
    T.press(T.find("ui.Button"))
    T.assert.called("HTTPRequest:Get", 1)
    local finished = T.calls("HTTPRequest:Get")[1].args[2]
    finished({ successful = true, responseCode = 200, data = "{}" })
    T.assert.equals("wiki answered 200 with 2 bytes", statusText())
end)

T.test("a failed request shows the error", function()
    T.load()
    T.press(T.find("ui.Button"))
    local finished = T.calls("HTTPRequest:Get")[1].args[2]
    finished({ successful = false, errorInfo = "timeout" })
    T.assert.equals("request failed: timeout", statusText())
end)

T.test("PluginShutdown cancels a pending request and releases everything", function()
    T.load()
    local button = T.find("ui.Button")
    T.press(button)
    T.shutdown()
    T.assert.called("HTTPRequest:Cancel", 1)
    T.assert.equals({}, T.subscriptions())
    T.assert.equals({}, T.hooks(button))
    T.assert.is_nil(T.find("ui.GroupBox"))
end)
