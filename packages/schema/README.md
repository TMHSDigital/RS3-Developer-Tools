# @tmhs/rs3-plugin-schema

JSON Schema (draft 2020-12) for the RuneScape 3 `plugin.json` manifest.

The schema covers every field listed on the official structure page: `name`, `version`, `contactEmailAddress` (email format), `requiredDependencies` and `optionalDependencies` in both the array form and the alias-map form, `requiredPermissions` and `optionalPermissions` restricted to the known permission names, and `urls` as a map of Lua identifiers to HTTP or HTTPS URLs. The two UI flags `hasSettingsIcon` and `hasRibbonIcon` from the events page are included as booleans. Fields prefixed with `remote` are tolerated because the plugin repository writes them for downloaded plugins.

## Editor wiring

Copy the `json.schemas` block from `settings.sample.json` into your VS Code or Cursor `settings.json`, or add a `$schema` line to the manifest:

```json
{
  "$schema": "https://raw.githubusercontent.com/TMHSDigital/RS3-Developer-Tools/main/packages/schema/plugin.schema.json",
  "name": "My Plugin",
  "version": "0.1.0",
  "contactEmailAddress": "contact@example.com"
}
```

## Programmatic use

```ts
import { loadPluginSchema, PERMISSIONS } from "@tmhs/rs3-plugin-schema";
```

Documentation reference: https://developer.runescape.com/rs/structure.html
