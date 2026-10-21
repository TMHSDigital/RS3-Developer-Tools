-- Declares the wiki URL but also mentions a host that is not in the manifest.
local request = HTTPRequest.new(Plugin.urls.wiki, "w/Main_Page")
request:Get(function(req)
    log(req.successful)
end)

-- This literal points somewhere the manifest does not allow.
local elsewhere = "https://example.org/data.json"
print(elsewhere)
