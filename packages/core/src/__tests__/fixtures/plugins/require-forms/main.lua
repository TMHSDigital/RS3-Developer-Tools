-- Require-forms fixture: which require shapes the validator accepts.
-- A commented-out require("ghost/module") must not count.
local banner = "the string require('ghost/other') must not count either"

local a = require("lib/helpers")      -- documented form: ok
local b = require "lib/helpers"       -- call without parentheses: ok
local c = require("lib.helpers")      -- dotted: not documented, flagged with the slash form
local d = require("lib")              -- init.lua fallback: not documented, flagged
local e = require("../outside")       -- leaves the plugin: flagged

print(banner, a, b, c, d, e)
