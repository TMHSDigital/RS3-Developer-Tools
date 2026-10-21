-- Sandbox fixture: touches libraries the plugin sandbox does not provide.
-- The word "os.exit" inside this comment and the string below must not count.
local text = "io.open is only mentioned in a string here"
local clock = os.clock()
local handle = io.open("file.txt")
local chunk = load("return 1")
debug.traceback()
print(text, clock, handle, chunk)
