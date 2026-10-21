# @tmhs/rs3-devtools-core

Shared logic for RS3 Developer Tools. The `rs3dev` CLI and the MCP server are thin wrappers over these functions.

| Module | Exports | Purpose |
| --- | --- | --- |
| `manifest` | `validateManifestObject`, `readManifest`, `validatePluginDir`, `isDevArtifact` | plugin.json schema validation and folder checks |
| `preflight` | `preflightPlugin`, `FORBIDDEN_GLOBALS` | sandbox globals, permission gating, URL hosts, readability heuristics |
| `scaffold` | `scaffoldPlugin`, `renderMainLua`, `renderManifest` | `rs3dev init` |
| `sync` | `syncPlugin` | copy into `dev_plugins` with lock retries and pruning |
| `watch` | `watchPlugin` | debounced re-sync on save |
| `package` | `packagePlugin` | deterministic zip for mod.io |
| `paths` | `findDevPluginsRoot`, `cacheDir` | client folder detection via `*.jcache` |
| `docs-client` | `DocsClient`, `normaliseDocsPath` | live fetch with ETag cache under `%LOCALAPPDATA%\rs3-devtools\cache` |
| `docs-text` | `docsPageToText`, `extractNavLinks` | HTML to text for the MCP server |
| `lua-scan` | `scanLua`, `globalReads`, `memberChains` | small Lua lexer used by preflight |
| `luarc` | `writeLuarc`, `defaultStubsDir`, `stubsIndexPath` | LuaLS configuration |
| `findings` | `Finding`, `DOCS`, `formatFindings` | finding model with docs links |

All text output is UTF-8 without BOM and every path goes through `node:path`.

```ts
import { preflightPlugin } from "@tmhs/rs3-devtools-core";

const result = await preflightPlugin("C:/dev/my-plugin");
for (const finding of result.findings) console.log(finding.level, finding.code, finding.docsUrl);
```
