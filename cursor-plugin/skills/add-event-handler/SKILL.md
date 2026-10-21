---
name: add-event-handler
description: Subscribe an RS3 plugin to a client event with a typed callback, a namespaced reference name, and cleanup in PluginShutdown.
triggers:
  - "react when an NPC spawns"
  - "subscribe to a game event"
  - "run code every tick"
  - "handle chat messages in the plugin"
  - "listen for a minimenu selection"
  - "add an event handler"
standards-version: 1.10.1
---

# Add an event handler

Wire `Event.<Name>.Subscribe(ref, callback)` for one of the client events, with the payload fields taken from the stubs, and release it on shutdown.

## When to use

- The plugin must react to something the client reports: entity added or removed, variable transmitted, key pressed, chat message, minimenu entry selected, world or region change, settings layer shown.
- Periodic work is needed (`Event.Logic`, `Event.ServerLogic`, `Event.Draw`).

## When NOT to use

- Reacting to clicks on the plugin's own components: use component hooks (`add-ui-window`).
- Reading static data once at startup: call the API directly.

## Steps

1. Pick the event. Look it up with `api_lookup` (MCP) or hover `Event.` in the editor; every event is listed at https://developer.runescape.com/rs/core/events.html#supported-events. Check the payload fields in the stub (`<Name>Event` class).
2. Check permissions: `Event.ChatMessage` needs `chatAccess` in `plugin.json` and should be gated with `Plugin.HasPermission`.
3. Add a reference name to the plugin's table of refs, namespaced by plugin:

```lua
local REFS = {
    npcAdded = "lootTally.npcAdded",
}
```

4. Write the callback as a named local function with the payload typed by the stubs:

```lua
---@param event NPCEntityAddedEvent
local function onNpcAdded(event)
    if not event.npcEntity.isValid then
        return
    end
    log("spawned: " .. event.npcEntity.displayName)
end
```

   `Event.EntityDraw` callbacks must return a boolean; events without payload (`ServerLogic`, `WorldUpdated`, `RegionUpdated`) take no parameter.
5. Subscribe after the callback is defined:

```lua
Event.NPCEntityAdded.Subscribe(REFS.npcAdded, onNpcAdded)
```

6. Keep per-tick handlers cheap: no list scans in `Event.Logic` or `Event.Draw`; throttle with a counter and cache results.
7. Unsubscribe in `PluginShutdown`:

```lua
function PluginShutdown()
    Event.NPCEntityAdded.Unsubscribe(REFS.npcAdded)
end
```

8. Reload with `prl <name>` and confirm the handler fires once per event; duplicate log lines mean an earlier subscription was never released.

## Examples

Request: "log every private chat message"

Result: `chatAccess` added to `optionalPermissions`, a `hasChatAccess()` helper, `Event.ChatMessage.Subscribe("lootTally.chat", onChat)` where `onChat` checks `event.chatType == ChatType.PRIVATE_INCOMING` and the permission before logging, plus the matching `Unsubscribe`.

## Reference

- Events: https://developer.runescape.com/rs/core/events.html
- Events tutorial: https://developer.runescape.com/rs/tutorial/4events.html
- Chat permission: https://developer.runescape.com/rs/game/chat.html#requirements
