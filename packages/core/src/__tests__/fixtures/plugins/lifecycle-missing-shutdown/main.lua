-- Subscribes to an event but never defines PluginShutdown: a reload (prl)
-- leaves the handler attached and it fires twice.
local function onNpcAdded(event)
    log(event.npcEntity.displayName)
end

Event.NPCEntityAdded.Subscribe("missingShutdown.npcAdded", onNpcAdded)
