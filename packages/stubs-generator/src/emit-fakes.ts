// Emit fakes/rs3_api_fakes.lua: a runtime stand-in for the whole Client API,
// built from the same model as the stubs so the two can never disagree.
//
// The file is data plus a small prelude. Every class becomes a table whose
// functions record their call and return a default of the documented return
// type (0, "", false, {} or a fake instance); every enum keeps its documented
// values; every Event.<Name> can be subscribed to, unsubscribed from and
// emitted; config.<Name>, id.<Name> and var.<Domain> answer any key. No game
// logic is reproduced. rs3dev test loads this file, then test-runtime/rs3_test.lua
// layers behaviour on top (in-memory PersistentDB, component tree, assertions).

import type { ClassDef, GlobalTables, ModuleDef } from "./types.js";

export interface FakesOptions {
  baseUrl: string;
  aliases: { name: string; type: string }[];
}

interface MergedClass {
  name: string;
  parent?: string;
  isGlobal: boolean;
  fields: Map<string, string>;
  methods: { name: string; sep: "." | ":"; returns: string[] }[];
  index?: { keyType: string; valueType: string };
}

/** Lua string literal. Names and types are ASCII, so JSON escaping is valid Lua. */
function lua(text: string): string {
  return JSON.stringify(text);
}

function luaList(items: string[]): string {
  return `{ ${items.map(lua).join(", ")} }`;
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Collapse the per-page class copies into one definition per class name. */
function mergeClasses(modules: ModuleDef[]): MergedClass[] {
  const merged = new Map<string, MergedClass>();
  const add = (cls: ClassDef) => {
    const entry: MergedClass = merged.get(cls.name) ?? { name: cls.name, isGlobal: false, fields: new Map<string, string>(), methods: [] };
    if (!cls.canonical) {
      entry.parent = entry.parent ?? cls.parent;
      entry.isGlobal = entry.isGlobal || cls.isGlobal;
      for (const f of cls.fields) if (!entry.fields.has(f.name)) entry.fields.set(f.name, f.type);
      if (cls.index && !entry.index) entry.index = { keyType: cls.index.keyType, valueType: cls.index.valueType };
    }
    for (const m of cls.methods) {
      if (m.sep === "" || entry.methods.some((e) => e.name === m.name && e.sep === m.sep)) continue;
      entry.methods.push({ name: m.name, sep: m.sep, returns: m.returns });
    }
    merged.set(cls.name, entry);
  };
  // Canonical declarations first so parents and fields come from the owning page.
  for (const mod of modules) for (const cls of mod.classes) if (!cls.canonical) add(cls);
  for (const mod of modules) for (const cls of mod.classes) if (cls.canonical) add(cls);
  return [...merged.values()].sort(byName);
}

/** A class with no methods whose every field is typed as itself is a value set (ui.Hook, ui.AlignMode). */
function isEnumLike(cls: MergedClass): boolean {
  return cls.methods.length === 0 && cls.fields.size > 0 && [...cls.fields.values()].every((t) => t === cls.name);
}

const PRELUDE = `
local F = {}
F.classes = {}
F.enums = {}
F.events = {}
F.aliases = {}
F.calls = {}
F.instances = {}
-- Hooks the test runtime fills in: onNew(instance, ...) after a constructor,
-- onCall(qualifiedName, ...) before a default return (return true, results... to override).
F.hooks = {}

local function pack(...)
  return { n = select("#", ...), ... }
end

--- Record one call. The test runtime reads F.calls.
function F.record(name, self, args)
  F.calls[#F.calls + 1] = { name = name, self = self, args = args }
end

--- Assign a dotted global name ("ui.Button"), creating the namespaces on the way.
function F.setGlobal(name, value)
  local parts = {}
  for part in name:gmatch("[^.]+") do
    parts[#parts + 1] = part
  end
  local holder = _G
  for i = 1, #parts - 1 do
    local nextHolder = rawget(holder, parts[i])
    if type(nextHolder) ~= "table" then
      nextHolder = {}
      rawset(holder, parts[i], nextHolder)
    end
    holder = nextHolder
  end
  rawset(holder, parts[#parts], value)
end

local function resolveAlias(typeName)
  local seen = 0
  while F.aliases[typeName] and seen < 8 do
    typeName = F.aliases[typeName]
    seen = seen + 1
  end
  return typeName
end

local function smallestValue(enum)
  local best
  for _, value in pairs(enum) do
    if best == nil or (type(value) == type(best) and value < best) then
      best = value
    end
  end
  return best
end

--- A default value for a LuaLS type expression: 0, 0.0, "", false, {}, an enum
--- member, a fake instance, or nil for optional and unknown types.
function F.default(typeName)
  if typeName == nil or typeName == "" or typeName == "nil" or typeName == "any" then
    return nil
  end
  if typeName:sub(-1) == "?" then
    return nil
  end
  if typeName:sub(-2) == "[]" then
    return {}
  end
  local first = typeName:sub(1, 1)
  if first == "[" or first == "{" or typeName:sub(1, 5) == "table" then
    return {}
  end
  if typeName:sub(1, 3) == "fun" then
    return nil
  end
  if first == "(" then
    typeName = typeName:sub(2):gsub("%)$", "")
  end
  local head = typeName:match("^([^|]+)|")
  if head then
    return F.default(head)
  end
  if typeName == "integer" then
    return 0
  elseif typeName == "number" then
    return 0.0
  elseif typeName == "string" then
    return ""
  elseif typeName == "boolean" then
    return false
  end
  typeName = resolveAlias(typeName)
  if F.enums[typeName] then
    return smallestValue(F.enums[typeName])
  end
  if F.classes[typeName] then
    return F.instance(typeName)
  end
  return nil
end

--- Walk a class and its parents for a function or a field default.
local function lookup(def, holder, key)
  local current = def
  while current do
    if current.table ~= holder then
      local member = rawget(current.table, key)
      if member ~= nil then
        return member
      end
    end
    local fieldType = current.fields[key]
    if fieldType then
      local value = F.default(fieldType)
      rawset(holder, key, value)
      return value
    end
    current = current.parent and F.classes[current.parent] or nil
  end
  if def.index then
    local value = F.default(def.index[2])
    rawset(holder, key, value)
    return value
  end
  return nil
end

--- Create a fake instance of a class. Fields default lazily on first read;
--- "fields" presets some of them.
function F.instance(className, fields)
  className = resolveAlias(className)
  local def = F.classes[className]
  if not def then
    error("unknown class " .. tostring(className))
  end
  local inst = {}
  if fields then
    for key, value in pairs(fields) do
      inst[key] = value
    end
  end
  setmetatable(inst, {
    __class = className,
    __index = function(self, key)
      return lookup(def, self, key)
    end,
    __tostring = function()
      return className
    end,
  })
  F.instances[#F.instances + 1] = inst
  return inst
end

--- Class name of a fake instance or class table, or nil.
function F.classOf(value)
  local mt = type(value) == "table" and getmetatable(value)
  return mt and mt.__class or nil
end

--- True when the value's class is name or inherits from it.
function F.isA(value, name)
  local current = F.classOf(value)
  while current do
    if current == name then
      return true
    end
    local def = F.classes[current]
    current = def and def.parent or nil
  end
  return false
end

--- Define a class: def = { parent=, global=, fields = { name = type }, methods = { { name, sep, returns } }, index = { key, value } }.
function F.defineClass(name, def)
  def.name = name
  def.table = rawget(F.classes, name) and F.classes[name].table or {}
  def.fields = def.fields or {}
  def.methods = def.methods or {}
  F.classes[name] = def
  for _, m in ipairs(def.methods) do
    local methodName, sep, returns = m[1], m[2], m[3]
    local qualified = name .. sep .. methodName
    local isConstructor = sep == "." and methodName == "new" and returns[1] == name
    def.table[methodName] = function(...)
      local args = pack(...)
      F.record(qualified, sep == ":" and args[1] or nil, args)
      if F.hooks.onCall then
        local handled = pack(F.hooks.onCall(qualified, ...))
        if handled[1] then
          return table.unpack(handled, 2, handled.n)
        end
      end
      if isConstructor then
        local inst = F.instance(name)
        if F.hooks.onNew then
          F.hooks.onNew(inst, ...)
        end
        return inst
      end
      local out = {}
      for i, returnType in ipairs(returns) do
        out[i] = F.default(returnType)
      end
      return table.unpack(out, 1, #returns)
    end
  end
  setmetatable(def.table, {
    __class = name,
    __index = function(holder, key)
      return lookup(def, holder, key)
    end,
  })
  if def.global then
    F.setGlobal(name, def.table)
  end
end

--- A set of named values (ui.Hook, ui.AlignMode): each member is its own name.
function F.defineEnumLike(name, members, global)
  local tbl = {}
  for _, member in ipairs(members) do
    tbl[member] = member
  end
  F.enums[name] = tbl
  F.classes[name] = { name = name, table = tbl, fields = {}, methods = {} }
  if global then
    F.setGlobal(name, tbl)
  end
end

--- A documented enum: members = { { name, value } }; a member without a value gets its name.
function F.defineEnum(name, members)
  local tbl = {}
  for _, member in ipairs(members) do
    tbl[member[1]] = member[2] == nil and member[1] or member[2]
  end
  F.enums[name] = tbl
  F.setGlobal(name, tbl)
end

--- A global function (log, formatStr, lerp).
function F.defineFunction(name, returns)
  F.setGlobal(name, function(...)
    F.record(name, nil, pack(...))
    if F.hooks.onCall then
      local handled = pack(F.hooks.onCall(name, ...))
      if handled[1] then
        return table.unpack(handled, 2, handled.n)
      end
    end
    local out = {}
    for i, returnType in ipairs(returns) do
      out[i] = F.default(returnType)
    end
    return table.unpack(out, 1, #returns)
  end)
end

--- Build an event payload: declared fields default lazily, plain tables given
--- for class-typed fields become instances of that class.
function F.payload(eventName, fields)
  local ev = F.events[eventName]
  local types = ev and ev.payload or {}
  local payload = {}
  for key, value in pairs(fields or {}) do
    local fieldType = types[key] and resolveAlias(types[key])
    if type(value) == "table" and getmetatable(value) == nil and fieldType and F.classes[fieldType] then
      value = F.instance(fieldType, value)
    end
    payload[key] = value
  end
  return setmetatable(payload, {
    __index = function(self, key)
      local fieldType = types[key]
      if fieldType then
        local value = F.default(fieldType)
        rawset(self, key, value)
        return value
      end
      return nil
    end,
  })
end

--- Event.<name> with Subscribe, Unsubscribe and a test-only Emit(fields).
function F.defineEvent(name, payload, returnsBoolean)
  local ev = { name = name, payload = payload, returnsBoolean = returnsBoolean, subscriptions = {}, order = {} }
  function ev.Subscribe(ref, callback)
    F.record("Event." .. name .. ".Subscribe", nil, pack(ref, callback))
    if ev.subscriptions[ref] == nil then
      ev.order[#ev.order + 1] = ref
    end
    ev.subscriptions[ref] = callback
  end
  function ev.Unsubscribe(ref)
    F.record("Event." .. name .. ".Unsubscribe", nil, pack(ref))
    ev.subscriptions[ref] = nil
    for i, existing in ipairs(ev.order) do
      if existing == ref then
        table.remove(ev.order, i)
        break
      end
    end
  end
  function ev.Emit(fields)
    local event = F.payload(name, fields)
    local results = {}
    for _, ref in ipairs(ev.order) do
      local callback = ev.subscriptions[ref]
      if callback then
        results[ref] = pack(callback(event))
      end
    end
    return results
  end
  F.events[name] = ev
  F.setGlobal("Event." .. name, ev)
end

--- Deterministic integer for a name, so id.<Name>.<KEY> is stable across runs.
function F.stableId(text)
  local hash = 5381
  for i = 1, #text do
    hash = (hash * 33 + text:byte(i)) % 2147483647
  end
  return hash
end

local function lookupTable(make, fromId)
  local tbl = {}
  if fromId then
    tbl.FromID = function(id)
      return make(tostring(id))
    end
  end
  return setmetatable(tbl, {
    __index = function(self, key)
      local value = make(key)
      rawset(self, key, value)
      return value
    end,
  })
end

--- config.<Name> (records of <Name>Type), id.<Name> (integers), var.<Domain> (VarType).
function F.defineLookups(config, ids, vars)
  F.setGlobal("config", {})
  F.setGlobal("id", {})
  F.setGlobal("var", {})
  for name, valueType in pairs(config) do
    config[name] = nil
    _G.config[name] = lookupTable(function(key)
      if F.classes[valueType] then
        return F.instance(valueType, { id = F.stableId("id." .. name .. "." .. key), name = key })
      end
      return { id = F.stableId("id." .. name .. "." .. key), name = key }
    end, true)
  end
  for _, name in ipairs(ids) do
    _G.id[name] = lookupTable(function(key)
      return F.stableId("id." .. name .. "." .. key)
    end, false)
  end
  for _, domain in ipairs(vars) do
    _G.var[domain] = lookupTable(function(key)
      return F.instance("VarType", { id = F.stableId("var." .. domain .. "." .. key), name = key })
    end, true)
  end
end

--- Forget recorded calls, instances and event subscriptions.
function F.reset()
  F.calls = {}
  F.instances = {}
  for _, ev in pairs(F.events) do
    ev.subscriptions = {}
    ev.order = {}
  end
end
`;

export function emitFakes(modules: ModuleDef[], globals: GlobalTables, options: FakesOptions): { path: string; content: string } {
  const lines: string[] = [
    "---@diagnostic disable",
    "-- RuneScape Client API fakes: a runtime stand-in for rs3dev test",
    "-- Generated by @tmhs/rs3-stubs-generator from the same model as the stubs.",
    "-- Every global table, class, enum, event and lookup table of the API exists here; functions record",
    "-- their calls and return defaults of their documented types. No game logic is reproduced.",
    "-- Do not edit by hand; regenerate with: npm run stubs:generate",
    `-- Docs: ${options.baseUrl}`,
    PRELUDE.trimEnd(),
    "",
    "-- Aliases",
  ];
  for (const alias of [...options.aliases].sort(byName)) lines.push(`F.aliases[${lua(alias.name)}] = ${lua(alias.type)}`);

  lines.push("", "-- Enumerations");
  const enums = modules.flatMap((m) => m.enums.map((e) => ({ name: e.name, members: e.members }))).sort(byName);
  for (const e of enums) {
    const members = e.members.map((m) => (m.value === undefined ? `{ ${lua(m.name)} }` : `{ ${lua(m.name)}, ${m.value} }`));
    lines.push(`F.defineEnum(${lua(e.name)}, { ${members.join(", ")} })`);
  }

  lines.push("", "-- Classes (parents first so inheritance resolves while defining)");
  const classes = mergeClasses(modules);
  const emitted = new Set<string>();
  const byNameMap = new Map(classes.map((c) => [c.name, c]));
  const emitClass = (cls: MergedClass) => {
    if (emitted.has(cls.name)) return;
    emitted.add(cls.name);
    if (cls.parent && byNameMap.has(cls.parent)) emitClass(byNameMap.get(cls.parent)!);
    if (isEnumLike(cls)) {
      lines.push(`F.defineEnumLike(${lua(cls.name)}, ${luaList([...cls.fields.keys()])}, ${cls.isGlobal})`);
      return;
    }
    const fields = [...cls.fields.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const parts = [cls.parent ? `parent = ${lua(cls.parent)}` : "", `global = ${cls.isGlobal}`];
    if (fields.length > 0) parts.push(`fields = { ${fields.map(([k, t]) => `[${lua(k)}] = ${lua(t)}`).join(", ")} }`);
    if (cls.methods.length > 0) {
      const methods = [...cls.methods].sort(byName).map((m) => `{ ${lua(m.name)}, ${lua(m.sep)}, ${luaList(m.returns)} }`);
      parts.push(`methods = { ${methods.join(", ")} }`);
    }
    if (cls.index) parts.push(`index = ${luaList([cls.index.keyType, cls.index.valueType])}`);
    lines.push(`F.defineClass(${lua(cls.name)}, { ${parts.filter(Boolean).join(", ")} })`);
  };
  for (const cls of classes) emitClass(cls);

  // Component hooks are documented as callback variants, not as a class; the
  // stubs declare them as the ui.Hook value set and so do the fakes.
  const hookNames = [...new Set(modules.flatMap((m) => m.hooks.map((h) => h.name)))].sort();
  if (hookNames.length > 0 && !emitted.has("ui.Hook")) lines.push("", "-- Component hooks", `F.defineEnumLike("ui.Hook", ${luaList(hookNames)}, true)`);

  lines.push("", "-- Events");
  const events = modules.flatMap((m) => m.events).sort(byName);
  if (events.length > 0 && !emitted.has("Event")) lines.push('F.setGlobal("Event", {})');
  for (const ev of events) {
    const payload = [...ev.payload].sort(byName).map((f) => `[${lua(f.name)}] = ${lua(f.type)}`);
    lines.push(`F.defineEvent(${lua(ev.name)}, { ${payload.join(", ")} }, ${ev.returnsBoolean})`);
  }

  lines.push("", "-- Global functions");
  const functions = modules.flatMap((m) => m.freeFunctions.map((f) => ({ name: f.name, returns: f.returns }))).sort(byName);
  const seenFunctions = new Set<string>();
  for (const fn of functions) {
    if (seenFunctions.has(fn.name)) continue;
    seenFunctions.add(fn.name);
    lines.push(`F.defineFunction(${lua(fn.name)}, ${luaList(fn.returns)})`);
  }

  lines.push("", "-- Lookup tables");
  const config = Object.keys(globals.config)
    .sort()
    .map((name) => `[${lua(name)}] = ${lua(globals.config[name]!)}`);
  lines.push(`F.defineLookups({ ${config.join(", ")} }, ${luaList([...globals.id].sort())}, ${luaList([...globals.var].sort())})`);

  lines.push("", "return F", "");
  return { path: "fakes/rs3_api_fakes.lua", content: lines.join("\n") };
}
