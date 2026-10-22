# Examples

Reference plugins for RS3 Developer Tools. Every example passes `rs3dev validate`, `rs3dev preflight` and the LuaLS check against the generated stubs in CI, and CI packages each one to prove the zip layout. Each folder is a complete plugin: copy it into the client's `dev_plugins` folder (`rs3dev sync examples/<name>`) and enable it from the console with `pon <name>`.

| Example | Demonstrates | Rules it compiles |
| --- | --- | --- |
| [`hello-counter`](hello-counter/) | A window built from UI components, a value kept across reloads in PersistentDB, one game event subscription, a `require`d helper module | `rs3-lua-idioms`, `rs3-events`, `rs3-persistentdb`, `rs3-readability` |
| [`wiki-prices`](wiki-prices/) | Optional `httpAccess`, a base URL declared under `urls`, a request built from `Plugin.urls`, the `Plugin.HasPermission` gate and `Event.OptionalPermissionChanged` | `rs3-permissions`, `rs3-manifest`, `rs3-secrets` |
| [`settings-panel`](settings-panel/) | `hasSettingsIcon`, building into `Event.SettingsLayerReady`, a `ui.Check` whose state lives in PersistentDB per character | `rs3-manifest`, `rs3-persistentdb`, `rs3-events` |
| [`chat-logger`](chat-logger/) | Optional `chatAccess`, `Event.ChatMessage` filtered by `ChatType`, counting without storing other players' text, subscribing only while the permission is granted | `rs3-permissions`, `rs3-events`, `rs3-ai-policy` |

The contact addresses in these manifests are placeholders on purpose; `rs3dev package` refuses them unless `--allow-placeholder-email` is passed, which is what CI does. Replace the address before shipping anything derived from an example.
