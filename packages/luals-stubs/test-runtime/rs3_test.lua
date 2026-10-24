-- rs3_test: run plugin code outside the client against the generated API fakes.
--
-- rs3dev test loads this module before each test file; a test file does
--
--   local T = require("rs3_test")
--   T.test("click increments the counter", function()
--       T.load()
--       T.press(T.find("ui.Button"))
--       T.assert.equals(1, T.db["helloCounter:clicks:Tester"])
--   end)
--
-- Every test starts from a clean state: no calls recorded, an empty
-- PersistentDB, no components, no event subscriptions and no PluginShutdown.
-- The fakes (fakes/rs3_api_fakes.lua) give every API table, class, enum and
-- event a shape; this file adds the behaviour tests need: an in-memory
-- PersistentDB, a component tree with hooks, a logged-in player, log and
-- formatStr, Plugin.HasPermission, and the load, reload and shutdown cycle.
-- Hand-written; not regenerated with the stubs.

local F = require("rs3_api_fakes")

---@class rs3.Assert
local Assert = {}

---@class rs3.Test
---@field fakes table the generated API fakes: calls, instances, events, classes
---@field logs string[] every log() line since the last reset
---@field db table<string, any> the in-memory PersistentDB store
---@field components table[] every ui component created since the last reset
---@field root any the plugin layer that ui.Interfaces:GetComponent returns
---@field player any what PlayerList.Self() returns; displayName "Tester" by default
---@field permissions table<string, boolean> what Plugin.HasPermission answers true to
---@field dependencies table<string, boolean> globals installed by T.dependency
---@field assert rs3.Assert
local T = { fakes = F, logs = {}, db = {}, components = {}, permissions = {}, dependencies = {}, assert = Assert }

local registry = {}
local currentFile = "(unknown)"
local baselineModules = {}

local function pack(...)
  return { n = select("#", ...), ... }
end

-- Fail the running test. The level skips the assertion helper so the message points at the test line.
local function fail(message, level)
  error(message, (level or 1) + 2)
end

local function describe(value)
  if type(value) == "string" then
    return string.format("%q", value)
  end
  if type(value) == "table" then
    local class = F.classOf(value)
    if class then
      return class .. " instance"
    end
    local parts = {}
    for key, item in pairs(value) do
      parts[#parts + 1] = tostring(key) .. " = " .. describe(item)
      if #parts >= 8 then
        parts[#parts + 1] = "..."
        break
      end
    end
    return "{ " .. table.concat(parts, ", ") .. " }"
  end
  return tostring(value)
end

local function deepEqual(a, b)
  if a == b then
    return true
  end
  if type(a) ~= "table" or type(b) ~= "table" then
    return false
  end
  for key, value in pairs(a) do
    if not deepEqual(value, b[key]) then
      return false
    end
  end
  for key in pairs(b) do
    if a[key] == nil then
      return false
    end
  end
  return true
end

-- Assertions --------------------------------------------------------------

---@param expected any
---@param actual any
---@param message? string
function Assert.equals(expected, actual, message)
  if not deepEqual(expected, actual) then
    fail((message and message .. ": " or "") .. "expected " .. describe(expected) .. ", got " .. describe(actual))
  end
end

---@param unexpected any
---@param actual any
---@param message? string
function Assert.not_equals(unexpected, actual, message)
  if deepEqual(unexpected, actual) then
    fail((message and message .. ": " or "") .. "expected a value other than " .. describe(unexpected))
  end
end

---@param value any
---@param message? string
function Assert.is_true(value, message)
  if value ~= true then
    fail((message and message .. ": " or "") .. "expected true, got " .. describe(value))
  end
end

---@param value any
---@param message? string
function Assert.is_false(value, message)
  if value ~= false then
    fail((message and message .. ": " or "") .. "expected false, got " .. describe(value))
  end
end

---@param value any
---@param message? string
function Assert.is_nil(value, message)
  if value ~= nil then
    fail((message and message .. ": " or "") .. "expected nil, got " .. describe(value))
  end
end

---@param value any
---@param message? string
function Assert.not_nil(value, message)
  if value == nil then
    fail((message and message .. ": " or "") .. "expected a value, got nil")
  end
end

---@param list any[]
---@param value any
---@param message? string
function Assert.contains(list, value, message)
  for _, item in ipairs(list) do
    if deepEqual(item, value) then
      return
    end
  end
  fail((message and message .. ": " or "") .. "list does not contain " .. describe(value) .. ": " .. describe(list))
end

---@param text string
---@param pattern string
---@param message? string
function Assert.matches(text, pattern, message)
  if type(text) ~= "string" or not text:find(pattern) then
    fail((message and message .. ": " or "") .. describe(text) .. " does not match " .. string.format("%q", pattern))
  end
end

---@param fn function
---@param pattern? string
---@param message? string
function Assert.errors(fn, pattern, message)
  local ok, err = pcall(fn)
  if ok then
    fail((message and message .. ": " or "") .. "expected an error")
  end
  if pattern and not tostring(err):find(pattern) then
    fail((message and message .. ": " or "") .. "error " .. describe(tostring(err)) .. " does not match " .. string.format("%q", pattern))
  end
end

--- The API call was recorded `times` times (at least once when omitted).
---@param name string qualified name as the stubs write it, for example "PersistentDB:SetInt" or "Event.Logic.Subscribe"
---@param times? integer
---@param message? string
function Assert.called(name, times, message)
  local count = #T.calls(name)
  if times == nil and count == 0 then
    fail((message and message .. ": " or "") .. name .. " was never called")
  elseif times ~= nil and count ~= times then
    fail((message and message .. ": " or "") .. name .. " was called " .. count .. " time(s), expected " .. times)
  end
end

---@param name string
---@param message? string
function Assert.not_called(name, message)
  local count = #T.calls(name)
  if count > 0 then
    fail((message and message .. ": " or "") .. name .. " was called " .. count .. " time(s)")
  end
end

-- Behaviour on top of the fakes ------------------------------------------

local Component = F.classes["ui.Component"] and F.classes["ui.Component"].table
if not Component then
  error("rs3_api_fakes.lua does not define ui.Component; regenerate the stubs")
end

local function hooksOf(component)
  local hooks = rawget(component, "hooks")
  if not hooks then
    hooks = {}
    rawset(component, "hooks", hooks)
  end
  return hooks
end

function Component:Subscribe(hook, callback)
  F.record("ui.Component:Subscribe", self, pack(self, hook, callback))
  hooksOf(self)[hook] = callback
end

function Component:Unsubscribe(hook)
  F.record("ui.Component:Unsubscribe", self, pack(self, hook))
  hooksOf(self)[hook] = nil
end

function Component:UnsubscribeAll()
  F.record("ui.Component:UnsubscribeAll", self, pack(self))
  rawset(self, "hooks", {})
end

function Component:Destroy()
  F.record("ui.Component:Destroy", self, pack(self))
  rawset(self, "destroyed", true)
  rawset(self, "hooks", {})
  local parent = rawget(self, "parent")
  local siblings = parent and rawget(parent, "children")
  if siblings then
    for i, child in ipairs(siblings) do
      if child == self then
        table.remove(siblings, i)
        break
      end
    end
  end
  for _, child in ipairs(rawget(self, "children") or {}) do
    rawset(child, "destroyed", true)
  end
end

function Component:SetPos(x, y)
  F.record("ui.Component:SetPos", self, pack(self, x, y))
  rawset(self, "x", x)
  rawset(self, "y", y)
end

function Component:SetX(x)
  F.record("ui.Component:SetX", self, pack(self, x))
  rawset(self, "x", x)
end

function Component:SetY(y)
  F.record("ui.Component:SetY", self, pack(self, y))
  rawset(self, "y", y)
end

function Component:SetSize(width, height)
  F.record("ui.Component:SetSize", self, pack(self, width, height))
  rawset(self, "width", width)
  rawset(self, "height", height)
end

function Component:SetWidth(width)
  F.record("ui.Component:SetWidth", self, pack(self, width))
  rawset(self, "width", width)
end

function Component:SetHeight(height)
  F.record("ui.Component:SetHeight", self, pack(self, height))
  rawset(self, "height", height)
end

-- Constructors: remember the parent, build the tree, start with no hooks.
F.hooks.onNew = function(inst, parent)
  if not F.isA(inst, "ui.Component") then
    return
  end
  rawset(inst, "children", {})
  rawset(inst, "hooks", {})
  rawset(inst, "destroyed", false)
  if type(parent) == "table" then
    rawset(inst, "parent", parent)
    local siblings = rawget(parent, "children")
    if not siblings then
      siblings = {}
      rawset(parent, "children", siblings)
    end
    siblings[#siblings + 1] = inst
  end
  T.components[#T.components + 1] = inst
end

if ui and ui.Interfaces then
  ui.Interfaces.GetComponent = function(self, combinedID)
    F.record("ui.Interfaces:GetComponent", self, pack(self, combinedID))
    return T.root
  end
end

-- PersistentDB: a plain table, typed getters return nil on a type mismatch like the client.
local function typedGet(key, check)
  local value = T.db[key]
  if value == nil or not check(value) then
    return nil
  end
  return value
end

local function isInteger(value)
  return math.type(value) == "integer"
end

local function copy(value)
  if type(value) ~= "table" then
    return value
  end
  local out = {}
  for k, v in pairs(value) do
    out[k] = copy(v)
  end
  return out
end

local DB = {
  Get = function(_, key)
    return copy(T.db[key])
  end,
  GetBool = function(_, key)
    return typedGet(key, function(v)
      return type(v) == "boolean"
    end)
  end,
  GetInt = function(_, key)
    return typedGet(key, isInteger)
  end,
  GetFloat = function(_, key)
    return typedGet(key, function(v)
      return type(v) == "number"
    end)
  end,
  GetString = function(_, key)
    return typedGet(key, function(v)
      return type(v) == "string"
    end)
  end,
  GetStructuredData = function(_, key)
    return copy(typedGet(key, function(v)
      return type(v) == "table"
    end))
  end,
  CheckExists = function(_, key)
    return T.db[key] ~= nil
  end,
  CheckExistsTyped = function(_, key, valueType)
    local value = T.db[key]
    if value == nil then
      return false
    end
    if valueType == "integer" or valueType == "int" then
      return isInteger(value)
    end
    return type(value) == valueType
  end,
  IterateEntries = function(_, callback)
    local keys = {}
    for key in pairs(T.db) do
      keys[#keys + 1] = key
    end
    table.sort(keys)
    for _, key in ipairs(keys) do
      callback(key, copy(T.db[key]))
    end
  end,
  Delete = function(_, key)
    local existed = T.db[key] ~= nil
    T.db[key] = nil
    return existed
  end,
  Clear = function()
    T.db = {}
    return true
  end,
}
for _, setter in ipairs({ "Set", "SetBool", "SetInt", "SetFloat", "SetString", "SetStructuredData" }) do
  DB[setter] = function(_, key, value)
    T.db[key] = copy(value)
    return true
  end
end
for name, fn in pairs(DB) do
  PersistentDB[name] = function(self, ...)
    F.record("PersistentDB:" .. name, self, pack(self, ...))
    return fn(self, ...)
  end
end

if PlayerList then
  PlayerList.Self = function()
    F.record("PlayerList.Self", nil, pack())
    return T.player
  end
end

--- formatStr as the client documents it: each {} takes the next argument.
local function formatStr(format, ...)
  local args = pack(...)
  local index = 0
  return (tostring(format):gsub("{}", function()
    index = index + 1
    return tostring(args[index])
  end))
end
_G.formatStr = formatStr

_G.log = function(format, ...)
  local line = formatStr(format, ...)
  T.logs[#T.logs + 1] = line
  F.record("log", nil, pack(format, ...))
end

if Plugin then
  -- Documented as Plugin.HasPermission(permission); accept the colon form too.
  Plugin.HasPermission = function(first, second)
    local permission = first == Plugin and second or first
    F.record("Plugin.HasPermission", nil, pack(permission))
    return T.permissions[permission] == true
  end
end

--- A permissive stand-in for a dependency plugin's global (PrettyUI): every
--- field is another stand-in and every call returns one, so main.lua runs
--- without the real library. Cleared on reset.
---@param name string
---@return any
function T.dependency(name)
  local function proxy()
    return setmetatable({}, {
      __index = function(self, key)
        local value = proxy()
        rawset(self, key, value)
        return value
      end,
      __call = function()
        return proxy()
      end,
      __tostring = function()
        return name .. " stand-in"
      end,
    })
  end
  local value = proxy()
  rawset(_G, name, value)
  T.dependencies[name] = true
  return value
end

-- Lifecycle ---------------------------------------------------------------

--- Run main.lua as the client does on load. Call once per test, after any setup.
function T.load()
  local root = RS3_PLUGIN_ROOT or "."
  local chunk, err = loadfile(root .. "/main.lua")
  if not chunk then
    error("could not load main.lua: " .. tostring(err), 2)
  end
  chunk()
end

--- Call PluginShutdown when the plugin defined one.
function T.shutdown()
  local hook = rawget(_G, "PluginShutdown")
  if type(hook) == "function" then
    hook()
  end
end

--- Shut down and load again, keeping PersistentDB, as a client reload does.
function T.reload()
  T.shutdown()
  for name in pairs(package.loaded) do
    if not baselineModules[name] then
      package.loaded[name] = nil
    end
  end
  rawset(_G, "PluginShutdown", nil)
  T.load()
end

--- Fire a component hook; ONBUTTONPRESSED by default. Returns what the callback returned.
---@param component any a component from T.find or the plugin
---@param hook? any
function T.press(component, hook, ...)
  hook = hook or (ui and ui.Hook and ui.Hook.ONBUTTONPRESSED) or "ONBUTTONPRESSED"
  local callback = hooksOf(component)[hook]
  if not callback then
    error("no callback subscribed on " .. tostring(F.classOf(component)) .. " for hook " .. tostring(hook), 2)
  end
  if select("#", ...) > 0 then
    return callback(component, ...)
  end
  return callback(component, 1, 0)
end

--- Emit a client event to every subscriber; fields missing from the payload take their documented defaults.
---@param eventName string for example "NPCEntityAdded"
---@param fields? table
function T.emit(eventName, fields)
  local ev = F.events[eventName]
  if not ev then
    error("unknown event " .. tostring(eventName), 2)
  end
  return ev.Emit(fields)
end

--- Every live event subscription as { event = name, ref = reference }, sorted.
function T.subscriptions()
  local list = {}
  for name, ev in pairs(F.events) do
    for _, ref in ipairs(ev.order) do
      list[#list + 1] = { event = name, ref = ref }
    end
  end
  table.sort(list, function(a, b)
    return a.event .. a.ref < b.event .. b.ref
  end)
  return list
end

--- Hook names a component still has callbacks for, sorted.
---@param component any
---@return string[]
function T.hooks(component)
  local names = {}
  for hook in pairs(hooksOf(component)) do
    names[#names + 1] = tostring(hook)
  end
  table.sort(names)
  return names
end

--- The first live component of a class ("ui.Button"), optionally matching a predicate.
--- Typed any so tests can read whatever property the plugin set without casts.
---@param className string
---@param predicate? fun(component: any): boolean
---@return any component nil when none is live
function T.find(className, predicate)
  for _, component in ipairs(T.components) do
    if not rawget(component, "destroyed") and F.isA(component, className) and (predicate == nil or predicate(component)) then
      return component
    end
  end
  return nil
end

--- Every live component of a class.
---@param className string
---@return any[]
function T.find_all(className)
  local list = {}
  for _, component in ipairs(T.components) do
    if not rawget(component, "destroyed") and F.isA(component, className) then
      list[#list + 1] = component
    end
  end
  return list
end

--- Recorded calls of one qualified API name, in order: { name, self, args } with args[1..args.n].
---@param name string
---@return any[]
function T.calls(name)
  local list = {}
  for _, call in ipairs(F.calls) do
    if call.name == name then
      list[#list + 1] = call
    end
  end
  return list
end

--- Clean slate: fakes, store, logs, components, player, permissions and PluginShutdown.
function T.reset()
  F.reset()
  T.db = {}
  T.logs = {}
  T.components = {}
  T.root = F.instance("ui.ComponentCollection")
  rawset(T.root, "children", {})
  rawset(T.root, "hooks", {})
  T.player = F.instance("PlayerEntity", { displayName = "Tester", isValid = true })
  T.permissions = {}
  for permission in tostring(RS3_PLUGIN_PERMISSIONS or ""):gmatch("[^,%s]+") do
    T.permissions[permission] = true
  end
  for name in pairs(T.dependencies) do
    rawset(_G, name, nil)
  end
  T.dependencies = {}
  for name in pairs(package.loaded) do
    if not baselineModules[name] then
      package.loaded[name] = nil
    end
  end
  rawset(_G, "PluginShutdown", nil)
end

-- Registry and runner -----------------------------------------------------

--- Register a test. The runner calls every registered test with a fresh state.
---@param name string
---@param fn fun()
function T.test(name, fn)
  registry[#registry + 1] = { name = name, fn = fn, file = currentFile }
end

--- Used by rs3dev test before loading each test file.
function T._set_file(file)
  currentFile = file
end

local function escapeLine(text)
  return (tostring(text):gsub("\\", "\\\\"):gsub("\n", "\\n"):gsub("\t", "    "))
end

--- Run every registered test and print one tab-separated line per result. Returns passed, failed.
---@param emit fun(line: string)
function T.run(emit)
  local passed, failed = 0, 0
  for _, entry in ipairs(registry) do
    T.reset()
    local ok, err = xpcall(entry.fn, function(message)
      local trace = debug.traceback(tostring(message), 2)
      -- Keep the plugin and test frames, drop the harness ones.
      return (trace:gsub("\n%s*%[C%]: in ?[^\n]*", ""):gsub("\n%s*[^\n]*rs3_test%.lua[^\n]*", ""))
    end)
    if ok then
      passed = passed + 1
      emit("RS3TEST\tok\t" .. escapeLine(entry.file) .. "\t" .. escapeLine(entry.name) .. "\t")
    else
      failed = failed + 1
      emit("RS3TEST\tfail\t" .. escapeLine(entry.file) .. "\t" .. escapeLine(entry.name) .. "\t" .. escapeLine(err))
    end
  end
  registry = {}
  return passed, failed
end

for name in pairs(package.loaded) do
  baselineModules[name] = true
end
T.reset()

return T
