-- Config fixture: rs3dev.json lowers maxLineLength to 60 and ignores
-- low-comment-ratio; an inline marker suppresses one sandbox finding.
local REFS = { logic = "configIgnore.logic" }

-- rs3dev-ignore sandbox-global
local clock = os.clock()

local unguarded = os.time() -- rs3dev-ignore
local longLine = { aaaaaaaaaaaaaaa = 1, bbbbbbbbbbbbbbbbbbb = 2, cccccccccccccc = 3 }

local function onLogic()
    log(clock, unguarded, longLine)
end

Event.Logic.Subscribe(REFS.logic, onLogic)

function PluginShutdown()
    Event.Logic.Unsubscribe(REFS.logic)
end
