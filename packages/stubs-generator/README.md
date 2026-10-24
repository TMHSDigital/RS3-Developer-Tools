# @tmhs/rs3-stubs-generator

Crawls the RuneScape Client API documentation navigation (Core, Game, Config types, Entities, Lists, Math, UI components, Events, Audio) and emits LuaLS `---@meta` stubs containing signatures only.

```powershell
rs3-stubs --out packages/luals-stubs            # crawl the live site (uses the local ETag cache)
rs3-stubs --out packages/luals-stubs --check    # exit 1 when the committed stubs are stale
rs3-stubs --out <dir> --offline <mirror dir>    # read pages from a local folder (tests)
```

## How a page becomes a stub

| Documentation shape | Output |
| --- | --- |
| `function Owner:Name(a : T) -> R` code block | `function Owner:Name(a) end` with `@param` and `@return` |
| Several signatures under one heading | First is the function, the rest become `@overload` |
| `Parameter / Type / Description` table | Fills parameter types the signature left untyped |
| `Returns / Description` table | Used when the signature line names a type no page declares |
| `Name / Type / Description` table under Properties | `@field` entries on the owning class |
| `Name / Value` table | `---@enum` with integer values |
| `Value / Description` table | Class whose fields are typed as the enum itself |
| `Payload variable` table on the events page | `<Name>Event` class and `Event.<Name>.Subscribe(ref, fun(e: <Name>Event))` |
| `ui.Hook` tables | `ui.Hook` fields plus `ui.HookCallback.<NAME>` aliases |
| `A -> B -> C` overview line | `---@class C : B` |
| `config.X`, `id.X`, `var.X` in code samples | Lookup tables in `_globals.lua` |

Type notation is converted (`Int` to `integer`, `[ X ]` to `X[]`, `A/B` to `A|B`, `{ K -> V }` to `table<K, V>`, `(A, B)` to `[A, B]`, `function (x : T) -> R` to `fun(x: T): R`). Unqualified UI names (`Button`, `Pos`) resolve to `ui.*` when such a class exists; abbreviations (`Cursor`) resolve to the matching `*Type` config class.

Anything else is written to `unresolved.md` rather than guessed: unparsed signatures, undeclared types (aliased to `any` so plugins still type-check), owner normalisations, heading/signature name differences, and prose in type cells.

## overrides.json

A short, hand-maintained list of facts the HTML structure does not state. Every entry cites its documentation anchor (`see`) and says why (`reason`); both are echoed in `unresolved.md` under "Overrides applied". The kinds:

| Key | Use | Example |
| --- | --- | --- |
| `classParents` | inheritance stated in prose | `Vector2 : Vector` |
| `eventCallbackReturnsBoolean` | callbacks that must return a value | `EntityDraw` |
| `extraFields` | members documented by heading only | `Plugin.urls` |
| `fieldTypes` | property rows whose type cell holds prose | `audio.SoundInstance.isPaused: boolean` |
| `classes` | opaque types described under a heading with no table | `RuntimeSprite`, `PluginAudioResource` |
| `derivedClasses` | types defined as another type minus some properties | `ui.TextDataConfig` from `ui.TextData` |
| `ownerPlaceholders` | signature owners written as placeholders | `game.options.<option name>` |
| `returnTypes` | signature line and returns table disagree (`types` for several values) | `ShapeList.GetEntity`, `FontType:GetStringHeightAndLineCount` |
| `renames` | heading and examples use another name than the signature | `ui.RadioGroup:SetOptions` |
| `memberAliases` | the docs use two names for one member; both are emitted | `AABB:AddPoint` beside `AddPosition` |
| `globalFunctions` | hooks a plugin defines in global scope | `PluginShutdown` |
| `aliases` | names that stand for another type | `VarPlayer = VarType` |

A test over the committed stubs fails when `_unresolved.lua` gains an `any` alias, so a new undeclared type in the docs has to be resolved here (or left as `any` with an explicit `aliases` entry and reason) before the regenerated stubs can land.

## Determinism

Pages are processed in sorted order, members keep document order, derived sets are sorted, and no timestamps are written. The test-suite runs the generator twice over synthetic fixture pages and asserts byte-identical output.

## Copyright

Only names, types, fields and enumeration members are emitted, each with a `@see` link to the documentation page. No documentation prose is stored in this repository; fetched pages live in the per-user cache only.
