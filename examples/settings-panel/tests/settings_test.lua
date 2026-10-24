-- Tests for Settings Panel, run outside the client with:   rs3dev test .
--
-- The panel is built when the client raises SettingsLayerReady with the
-- container reserved for this plugin; here that container is the fake plugin
-- layer T.root. The client flips a check box's value before firing the press
-- hook, so the tests set the value and then press.

local T = require("rs3_test")

local function openPanel()
    T.emit("SettingsLayerReady", { component = T.root })
    local check = T.find("ui.Check")
    T.assert.not_nil(check, "a check box on the settings layer")
    return check
end

T.test("builds the check box when the settings layer is ready", function()
    T.load()
    T.assert.equals({ { event = "SettingsLayerReady", ref = "settingsPanel.settingsLayerReady" } }, T.subscriptions())
    T.assert.is_nil(T.find("ui.Check"), "nothing is built before the layer is ready")
    local check = openPanel()
    T.assert.equals(T.root, check.parent)
    T.assert.equals("Show hints", check.label)
    T.assert.is_false(check.value, "off until the setting has been written once")
end)

T.test("pressing the check box stores the new state for the character", function()
    T.load()
    local check = openPanel()
    check.value = true
    T.press(check)
    local key, stored = next(T.db)
    T.assert.matches(tostring(key), "Tester$", "the key ends with the character name")
    T.assert.is_true(stored)
    T.assert.called("PersistentDB:SetBool", 1)
end)

T.test("a rebuilt panel shows the stored state", function()
    T.load()
    local check = openPanel()
    check.value = true
    T.press(check)
    T.reload()
    local rebuilt = openPanel()
    T.assert.is_true(rebuilt.value, "the stored value is read back")
    T.assert.equals(1, #T.find_all("ui.Check"), "the previous check box was destroyed")
end)

T.test("PluginShutdown releases the event and the check box", function()
    T.load()
    local check = openPanel()
    T.shutdown()
    T.assert.equals({}, T.subscriptions())
    T.assert.equals({}, T.hooks(check))
    T.assert.is_true(check.destroyed)
end)
