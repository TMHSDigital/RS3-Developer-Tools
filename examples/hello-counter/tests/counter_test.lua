-- Tests for Hello Counter, run outside the client with:   rs3dev test .
--
-- rs3_test loads main.lua against the generated API fakes: PersistentDB is an
-- in-memory table, components are plain tables with their hooks, events can be
-- emitted and PlayerList.Self() is a player called "Tester". Every test starts
-- from a clean state and loads the plugin itself.

local T = require("rs3_test")

local KEY = "helloCounter:clicks:Tester"

T.test("loads with the window, label and button on the plugin layer", function()
  T.load()
  local window = T.find("ui.GroupBox")
  T.assert.not_nil(window, "a GroupBox window")
  T.assert.equals(T.root, window.parent, "the window sits on the plugin layer")
  T.assert.equals(250, window.width)
  T.assert.equals(120, window.height)
  T.assert.not_nil(T.find("ui.Text"), "a label")
  T.assert.not_nil(T.find("ui.Button"), "a button")
  T.assert.equals("Clicks: 0", T.find("ui.Text").content)
end)

T.test("a click increments the label and saves the count per character", function()
  T.load()
  local button = T.find("ui.Button")
  T.press(button)
  T.press(button)
  T.assert.equals("Clicks: 2", T.find("ui.Text").content)
  T.assert.equals(2, T.db[KEY])
  T.assert.called("PersistentDB:SetInt", 2)
end)

T.test("the saved count survives a reload", function()
  T.load()
  T.press(T.find("ui.Button"))
  T.reload()
  T.assert.equals("Clicks: 1", T.find("ui.Text").content, "the label shows the stored value after reload")
  T.press(T.find("ui.Button"))
  T.assert.equals(2, T.db[KEY])
end)

T.test("falls back to a shared key when nobody is logged in", function()
  T.player.isValid = false
  T.load()
  T.press(T.find("ui.Button"))
  T.assert.equals(1, T.db["helloCounter:clicks:shared"])
  T.assert.is_nil(T.db[KEY])
end)

T.test("logs every NPC that appears", function()
  T.load()
  T.emit("NPCEntityAdded", { npcEntity = { displayName = "Goblin" } })
  T.assert.equals({ "NPC appeared: Goblin" }, T.logs)
end)

T.test("PluginShutdown releases the event, the hook and the window", function()
  T.load()
  T.assert.equals({ { event = "NPCEntityAdded", ref = "helloCounter.npcAdded" } }, T.subscriptions())
  local button = T.find("ui.Button")
  local window = T.find("ui.GroupBox")
  T.shutdown()
  T.assert.equals({}, T.subscriptions(), "no event subscriptions remain")
  T.assert.equals({}, T.hooks(button), "no component hooks remain")
  T.assert.is_true(window.destroyed, "the window was destroyed")
  T.assert.is_nil(T.find("ui.GroupBox"), "no live window remains")
end)
