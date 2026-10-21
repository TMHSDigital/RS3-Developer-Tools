-- Clean fixture: a tidy plugin that gates its optional permission.

local helpers = require("lib/helpers")

-- chatAccess is optional, so check before posting to chat.
local function announce(message)
    if Plugin.HasPermission(PluginPermissions.chatAccess) then
        Chat.AddMessage(message)
    else
        log(message)
    end
end

local function onLogic(event)
    if event.logicTick % 100 == 0 then
        announce(helpers.greeting())
    end
end

Event.Logic.Subscribe("cleanFixture.logic", onLogic)

function PluginShutdown()
    Event.Logic.Unsubscribe("cleanFixture.logic")
end
