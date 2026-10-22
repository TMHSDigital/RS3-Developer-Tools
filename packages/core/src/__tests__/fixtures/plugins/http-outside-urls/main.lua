-- Declares the wiki URL but also requests a host that is not in the manifest.
local request = HTTPRequest.new(Plugin.urls.wiki, "w/Main_Page")
request:Get(function(req)
    log(req.successful)
end)

-- This request goes somewhere the manifest does not allow: an error.
local elsewhere = HTTPRequest.new("https://example.org/", "data.json")
print(elsewhere)
