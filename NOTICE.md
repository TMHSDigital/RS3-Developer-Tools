# Notice

This repository is licensed under the MIT License (see `LICENSE`). This file records third-party material and attribution requirements.

## RuneScape Client API documentation

The RuneScape Client API documentation at https://developer.runescape.com/rs/ is copyright Jagex Ltd. This repository does not mirror, bundle, or redistribute that documentation. The generated LuaLS stubs in `packages/luals-stubs/` contain only API signatures (names, parameter and return types, fields, and enumeration members) together with `@see` links to the exact documentation page. Documentation prose is fetched at runtime by the MCP server and cached under `%LOCALAPPDATA%\rs3-devtools\cache` on the developer's machine; it is never committed to this repository.

RuneScape is a registered trademark of Jagex Ltd. This project is not affiliated with or endorsed by Jagex.

## Third-party code

No third-party source code is vendored into this repository. Runtime dependencies are declared in each package's `package.json` and are installed from npm under their own licenses.

The `rs3-api-ts` project (github.com/Rs3-Plugins/rs3-api-ts) was named as a potential cross-check source for API signatures. At the time this toolkit was built the repository was not publicly reachable, so no material from it was consulted or used. If it is consulted in a future revision, attribution is added here.
