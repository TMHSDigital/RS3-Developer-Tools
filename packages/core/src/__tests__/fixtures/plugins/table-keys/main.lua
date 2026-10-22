-- Table-keys fixture: bare names that look like sandboxed libraries but are
-- table constructor keys, parameters, field definitions, string keys or goto
-- labels. None of them reads the forbidden global, so preflight must stay quiet.

local settings = {
    debug = false,
    io = "inventory",
    load = { os = 1 };
    nested = { debug = { io = true } },
}

local M = {}

-- A parameter named like a library is a local.
local function describe(load)
    return load
end

-- A field definition is not a global read.
function M.load(x)
    return x
end

-- String keys are strings.
local t = { ["os"] = 1, ["debug"] = describe(2) }

-- goto labels are jump targets, not values.
for _ = 1, 1 do
    goto debug
    ::debug::
end

local function onLogic()
    if settings.debug then
        M.load(t)
    end
end

Event.Logic.Subscribe("tableKeys.logic", onLogic)

function PluginShutdown()
    Event.Logic.Unsubscribe("tableKeys.logic")
end
