-- Uses chat and the chat event without requesting chatAccess.
Chat.AddMessage("hello")

Event.ChatMessage.Subscribe("fixture.chat", function(event)
    log(event.chatMessage)
end)

-- Tracking id also needs its own permission.
local trackingId = Player.GetTrackingID()
print(trackingId)
