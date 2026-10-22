-- A plugin with its own chat panel module named Chat. It never touches the
-- client's Chat global, so no chatAccess permission is needed.
local Chat = {}
local HTTPRequest = { pending = 0 }

function Chat.AddMessage(text)
    log(text)
end

function Chat:Clear()
    self.lines = {}
end

function HTTPRequest.new()
    HTTPRequest.pending = HTTPRequest.pending + 1
end

Chat.AddMessage("hello from the local panel")
Chat:Clear()
HTTPRequest.new()

function PluginShutdown()
end
