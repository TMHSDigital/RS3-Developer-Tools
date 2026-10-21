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

A short, hand-maintained list of facts the HTML structure does not state (vector inheritance, the `EntityDraw` boolean return, `Plugin.urls`, the client-options placeholder owner, two optional global hooks). Every entry cites its documentation anchor and is echoed in `unresolved.md`.

## Determinism

Pages are processed in sorted order, members keep document order, derived sets are sorted, and no timestamps are written. The test-suite runs the generator twice over synthetic fixture pages and asserts byte-identical output.

## Copyright

Only names, types, fields and enumeration members are emitted, each with a `@see` link to the documentation page. No documentation prose is stored in this repository; fetched pages live in the per-user cache only.
