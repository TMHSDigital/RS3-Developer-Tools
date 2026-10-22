-- httpAccess is declared and every request uses a manifest URL. The literal
-- below is help text shown to the user and is never passed to HTTPRequest, so
-- it must not block packaging.
local HELP = "See https://runescape.wiki/w/Plugins and https://example.org/guide for setup"

local request = HTTPRequest.new(Plugin.urls.wiki, "w/Main_Page")
request:Get(function(req)
    log(req.successful and "fetched" or HELP)
end)

function PluginShutdown()
end
