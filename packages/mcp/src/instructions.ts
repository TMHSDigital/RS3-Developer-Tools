// Server instructions, sent in the initialise response so a client that has
// neither the Cursor rules nor the Claude Code skills installed still gets the
// non-negotiable rules. The text mirrors cursor-plugin/AGENTS.md; a repository
// test checks the two keep saying the same things.

export const SERVER_INSTRUCTIONS = `rs3-plugin-mcp helps write official RuneScape 3 plugins (Lua 5.4, RuneScape Client API). Tools read and write only inside the workspace the server was started for and the client's dev_plugins folder.

Workflow: plugin_scaffold (new folder), manifest_validate and guidelines_preflight after every change (both must report zero errors), devplugins_sync with confirm=true then "prl <name>" in the client console (ALT+backtick) to reload, package_zip for the zip that is uploaded by hand on mod.io. Use docs_search, api_lookup and docs_get (with a section) instead of guessing an API; every stub and finding links to the documentation page that states the rule.

Non-negotiable rules:
- Never use os, io, debug, load, loadstring or dofile (also not through _G); the sandbox does not provide them and moderators reject their presence.
- Declare httpAccess, chatAccess and trackingAccess in plugin.json before using the gated API; gate optional permissions with Plugin.HasPermission; request only URLs declared under urls through Plugin.urls.<name>.
- Every Subscribe has a matching Unsubscribe in PluginShutdown; every created component is destroyed there; no API list scans inside Event.Logic or Event.Draw handlers.
- PersistentDB keys include the character's display name when the value is per character.
- Code stays readable: local names, comments that explain intent, no minification, no encoded strings, no generated code the developer has not read.
- contactEmailAddress must be a real address; it is a legal requirement and package_zip refuses placeholders.

AI policy and copyright: only the workspace and pages fetched live from developer.runescape.com are inputs. Never read other developers' plugins (mod.io downloads, the client's plugins folder, third-party repositories). Link documentation, do not paste it: the RuneScape Client API docs are copyright Jagex. Every generated line is a draft until the developer has read it and tested it in the client. Guidelines: https://developer.runescape.com/rs/submission/guidelines.html

Distribution: upload is manual on mod.io with Jagex moderation; there is no API upload. Bump version for each resubmission.`;
