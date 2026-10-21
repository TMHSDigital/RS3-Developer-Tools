-- Helper module for the clean fixture.
local helpers = {}

-- A fixed greeting keeps the fixture deterministic.
function helpers.greeting()
    return "hello from the clean fixture"
end

return helpers
