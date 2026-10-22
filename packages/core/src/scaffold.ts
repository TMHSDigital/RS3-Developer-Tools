// rs3dev init: create a small, readable plugin that passes validate and
// preflight out of the box. Generated Lua is plain and commented because
// moderation rejects code that is hard to follow.

import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { PERMISSIONS, type Permission, type PluginManifest } from "@tmhs/rs3-plugin-schema";
import { isDirectory, listFilesRecursive, pathExists, writeUtf8NoBom } from "./fs.js";
import { writeLuarc } from "./luarc.js";

export interface ScaffoldOptions {
  /** Folder to create. Its basename is the plugin identifier used by the console. */
  dir: string;
  /** Display name for plugin.json. Defaults to the folder name. */
  name?: string;
  /** Permissions requested as optional and gated with Plugin.HasPermission in main.lua. */
  permissions?: Permission[];
  /** Permissions the plugin cannot work without. */
  requiredPermissions?: Permission[];
  /** Depend on the PrettyUI library plugin. */
  prettyUi?: boolean;
  contactEmail?: string;
  /** Base URLs to declare under urls in plugin.json, keyed by the Plugin.urls name. */
  urls?: Record<string, string>;
  /**
   * Shape of main.lua: "window" (a GroupBox with a label and a Logic handler,
   * the default), "event" (no UI, an event handler only), "library" (returns
   * a table for other plugins to depend on), "minimal" (PluginShutdown only).
   */
  template?: ScaffoldTemplate;
  /** Write .vscode/, .gitignore, .rs3ignore and README.md. Default true. */
  editorFiles?: boolean;
  /** Copy AGENTS.md, Cursor rules and Claude Code skills into the plugin folder. Default true. */
  agentFiles?: boolean;
  /** Stubs folder for .luarc.json; resolved automatically when omitted (RS3_STUBS_DIR, then the installed package). */
  stubsDir?: string;
  /** import.meta.url of the calling package so the stubs resolve next to the installed CLI. */
  resolveFrom?: string;
  env?: NodeJS.ProcessEnv;
  /** Allow writing into a non-empty folder (existing files are never overwritten). */
  force?: boolean;
}

export interface ScaffoldResult {
  dir: string;
  pluginName: string;
  files: string[];
  manifest: PluginManifest;
}

/**
 * Identifier used for the PrettyUI dependency. It must match the installed
 * library plugin's folder name exactly; the scaffold comments tell the reader to
 * confirm it with `plist` in the client console, because no stub declares it
 * (PrettyUI is a third-party library plugin, not part of the Client API).
 */
export const PRETTY_UI_PLUGIN_NAME = "PrettyUI";

const AGENT_FILES_DIR = fileURLToPath(new URL("../templates/agent-files/", import.meta.url));

function luaIdentifier(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
  return cleaned || "plugin";
}

export function renderManifest(options: ScaffoldOptions, pluginName: string): PluginManifest {
  const optional = [...new Set(options.permissions ?? [])];
  const required = [...new Set(options.requiredPermissions ?? [])].filter((p) => !optional.includes(p));
  const manifest: PluginManifest = {
    $schema: "https://raw.githubusercontent.com/TMHSDigital/RS3-Developer-Tools/main/packages/schema/plugin.schema.json",
    name: options.name ?? pluginName,
    version: "0.1.0",
    contactEmailAddress: options.contactEmail ?? "change-me@example.com",
    requiredDependencies: options.prettyUi ? [PRETTY_UI_PLUGIN_NAME] : [],
    optionalDependencies: [],
    requiredPermissions: required,
    optionalPermissions: optional,
  };
  // urls holds the base URLs the plugin may fetch. Only the ones the author
  // asked for are written; an unrequested entry would ship a declared host the
  // plugin never uses and hide the real one behind a preflight finding.
  const urls = Object.entries(options.urls ?? {});
  if (urls.length > 0) {
    manifest.urls = Object.fromEntries(urls.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  } else if (optional.includes("httpAccess") || required.includes("httpAccess")) {
    manifest.urls = {};
  }
  return manifest;
}

export const SCAFFOLD_TEMPLATES = ["window", "event", "library", "minimal"] as const;
export type ScaffoldTemplate = (typeof SCAFFOLD_TEMPLATES)[number];

/** Produce the commented main.lua for a new plugin. */
export function renderMainLua(options: ScaffoldOptions, pluginName: string): string {
  const displayName = options.name ?? pluginName;
  const ident = luaIdentifier(pluginName);
  const template: ScaffoldTemplate = options.template ?? "window";
  const optional = new Set(options.permissions ?? []);
  const required = new Set((options.requiredPermissions ?? []).filter((p) => !optional.has(p)));
  const lines: string[] = [];
  const push = (...l: string[]) => lines.push(...l);

  push(
    `-- ${displayName}`,
    "--",
    "-- Entry point. The client runs this file when the plugin is enabled and calls",
    "-- PluginShutdown() when it is disabled or reloaded.",
    "--",
    `-- Console: pon ${pluginName}   (enable)     prl ${pluginName}   (reload after edits)`,
    "",
    ...(template === "window" || template === "event"
      ? [
          "-- Reference names for event subscriptions, kept together so PluginShutdown can",
          "-- unsubscribe every one of them.",
          "local EVENT_REFS = {",
          `    logic = "${ident}.logic",`,
          "}",
          "",
        ]
      : []),
  );

  if (options.prettyUi) {
    push(
      `-- ${PRETTY_UI_PLUGIN_NAME} is listed in requiredDependencies, so the client loads it first and`,
      `-- exposes its exported table as the global ${PRETTY_UI_PLUGIN_NAME}. The identifier must match`,
      "-- the library's folder name exactly; confirm it with plist in the client console.",
      "-- No stub declares it, so .luarc.json lists it under diagnostics.globals.",
      "-- Keep calls to it in one place so the rest of the plugin does not depend on",
      "-- its API shape. Treat the table as read-only: it is shared with every importer.",
      `local prettyUi = ${PRETTY_UI_PLUGIN_NAME}`,
      "if prettyUi == nil then",
      `    error("${PRETTY_UI_PLUGIN_NAME} is not loaded; check the dependency name with plist")`,
      "end",
      "",
    );
  }

  for (const p of PERMISSIONS) {
    if (!optional.has(p)) continue;
    push(
      `-- ${p} is optional: the user can decline it or revoke it later. Check before`,
      "-- every use and keep the plugin useful without it.",
      `local function has${p[0]!.toUpperCase()}${p.slice(1)}()`,
      `    return Plugin.HasPermission(PluginPermissions.${p})`,
      "end",
      "",
    );
  }
  if (required.size > 0) {
    push(`-- Required permissions (${[...required].join(", ")}) are granted before the plugin is enabled,`, "-- so no runtime check is needed for them.", "");
  }
  if (optional.has("httpAccess") || required.has("httpAccess")) {
    const names = Object.keys(options.urls ?? {}).sort();
    push(
      "-- Every host the plugin fetches must be declared under urls in plugin.json and",
      "-- requested through Plugin.urls.<name>; a literal URL passed to HTTPRequest is",
      "-- refused by the client and reported by preflight.",
      ...(names.length > 0
        ? [`-- Declared: ${names.map((n) => `Plugin.urls.${n}`).join(", ")}`]
        : ['-- None declared yet: add "urls": { "api": "https://host/" } to plugin.json first.']),
      "",
    );
  }

  if (template === "window") {
    push(
      "-- Build the window: a GroupBox on the plugin layer with a single label.",
      "local pluginLayer = ui.Interfaces:GetComponent(id.Component.TOPLEVEL_V2__PLUGIN_BUILD_LAYER_TOP)",
      "if pluginLayer == nil then",
      '    error("plugin layer is not available; is the game interface loaded?")',
      "end",
      "---@cast pluginLayer ui.ComponentCollection",
      "",
      "local window = ui.GroupBox.new(pluginLayer)",
      "window.stylesheetID = id.StyleSheet.GROUPBOX_DEFAULT",
      "window:SetHeaderLayout(0, 0, 0, 0, ui.GroupBoxHeaderAlignMode.LEFT)",
      "window:SetSize(240, 80)",
      "window:SetPos(40, 40)",
      "",
      "local label = ui.Text.new(window)",
      "label:SetPos(0, 0)",
      "label:SetSize(0, 0, 1.0, 1.0)",
      "label.font = id.Font.MUSEO_SANS_15PT_REGULAR",
      "label:AlignTo(ui.AlignMode.CENTRE)",
      `label.content = "Hello from ${displayName}"`,
      "",
      "-- Logic runs every client tick. Keep the work here small.",
      "local ticks = 0",
      "local function onLogic(event)",
      "    ticks = ticks + 1",
      "    if ticks % 600 == 0 then",
      `        label.content = formatStr("Hello from ${displayName} ({} ticks)", ticks)`,
      "    end",
      "end",
      "Event.Logic.Subscribe(EVENT_REFS.logic, onLogic)",
      "",
      "-- Called by the client when the plugin is disabled or reloaded. Release every",
      "-- subscription and component so a reload starts clean.",
      "function PluginShutdown()",
      "    Event.Logic.Unsubscribe(EVENT_REFS.logic)",
      "    window:Destroy()",
      "end",
    );
  } else if (template === "event") {
    push(
      "-- No UI: this plugin only reacts to client events. Event.Logic runs every",
      "-- tick, so the handler counts ticks and does its work on a timer; swap it for",
      "-- the event you need (Event.NPCEntityAdded, Event.ChatMessage, ...) and keep",
      "-- the reference name in EVENT_REFS so PluginShutdown releases it.",
      "local ticks = 0",
      "local function onLogic(event)",
      "    ticks = ticks + 1",
      "    if ticks % 600 == 0 then",
      `        print(formatStr("${displayName}: {} ticks", ticks))`,
      "    end",
      "end",
      "Event.Logic.Subscribe(EVENT_REFS.logic, onLogic)",
      "",
      "-- Called by the client when the plugin is disabled or reloaded. Release every",
      "-- subscription so a reload starts clean.",
      "function PluginShutdown()",
      "    Event.Logic.Unsubscribe(EVENT_REFS.logic)",
      "end",
    );
  } else if (template === "library") {
    push(
      "-- A library plugin: other plugins list this folder name under",
      "-- requiredDependencies or optionalDependencies in their plugin.json and the",
      "-- client exposes the table returned below as a global named after the",
      "-- folder (or the alias they chose). Importers receive a clone, so keep the",
      "-- table free of per-plugin state and expose constructors instead.",
      "local library = {}",
      "",
      'library.version = "0.1.0"',
      "",
      "-- Example export. Replace with the functions this library provides.",
      "---@param value number",
      "---@return number",
      "function library.double(value)",
      "    return value * 2",
      "end",
      "",
      "-- Called by the client when the plugin is disabled or reloaded. A library",
      "-- usually has nothing to release; keep the function so the contract holds.",
      "function PluginShutdown()",
      "end",
      "",
      "return library",
    );
  } else {
    push(
      "-- Minimal plugin: nothing runs yet. Add state, UI and event subscriptions",
      "-- above PluginShutdown and release every one of them inside it.",
      "",
      "-- Called by the client when the plugin is disabled or reloaded.",
      "function PluginShutdown()",
      "end",
    );
  }
  return lines.join("\n") + "\n";
}

/** Editor and repository files written beside the plugin; all are development artefacts that never ship. */
export function renderEditorFiles(pluginName: string, displayName: string): Record<string, string> {
  return {
    ".vscode/extensions.json": JSON.stringify({ recommendations: ["sumneko.lua"] }, null, 2) + "\n",
    ".vscode/settings.json":
      JSON.stringify(
        {
          "json.schemas": [
            {
              fileMatch: ["plugin.json"],
              url: "https://raw.githubusercontent.com/TMHSDigital/RS3-Developer-Tools/main/packages/schema/plugin.schema.json",
            },
          ],
        },
        null,
        2,
      ) + "\n",
    ".gitignore": ["# Build output and archives from rs3dev package", "*.zip", "dist/", "", "# Editor caches", ".luals-cache/", ""].join("\n"),
    ".rs3ignore": [
      "# Files kept out of the mod.io zip and the dev_plugins copy (gitignore syntax).",
      "# README.md is written for this repository; remove the line below to ship it to users.",
      "README.md",
      "",
    ].join("\n"),
    "README.md": [
      `# ${displayName}`,
      "",
      "A RuneScape 3 plugin for the official client. Describe what it does here.",
      "",
      "## Develop",
      "",
      "```",
      "rs3dev validate .     # manifest and folder checks",
      "rs3dev preflight .    # sandbox, permission, lifecycle and readability checks",
      "rs3dev sync .         # copy into the client's dev_plugins folder",
      "rs3dev package .      # build the zip for the manual mod.io upload",
      "```",
      "",
      `In the client console (ALT+backtick): \`prf\` to refresh the list, \`pon ${pluginName}\` to enable, \`prl ${pluginName}\` to reload after edits.`,
      "",
      "RuneScape Client API documentation: https://developer.runescape.com/rs/",
      "",
    ].join("\n"),
  };
}

/** Copy AGENTS.md, the Cursor rules and the Claude Code skills into a plugin folder; existing files are kept. */
export async function copyAgentFiles(pluginDir: string): Promise<string[]> {
  const written: string[] = [];
  await copyTree(AGENT_FILES_DIR, path.resolve(pluginDir), written, "");
  return written.sort();
}

async function copyTree(from: string, to: string, written: string[], base: string): Promise<void> {
  if (!(await isDirectory(from))) return;
  for (const rel of await listFilesRecursive(from)) {
    const target = path.join(to, ...rel.split("/"));
    if (await pathExists(target)) continue;
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(path.join(from, ...rel.split("/")), target);
    written.push(path.posix.join(base, rel));
  }
}

export async function scaffoldPlugin(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const dir = path.resolve(options.dir);
  const pluginName = path.basename(dir);
  if (/\s/.test(pluginName)) {
    throw new Error(`plugin folder name "${pluginName}" must not contain spaces; it is the identifier used by the console`);
  }
  if (options.template && !(SCAFFOLD_TEMPLATES as readonly string[]).includes(options.template)) {
    throw new Error(`unknown template "${options.template}"; known templates are ${SCAFFOLD_TEMPLATES.join(", ")}`);
  }
  for (const p of [...(options.permissions ?? []), ...(options.requiredPermissions ?? [])]) {
    if (!(PERMISSIONS as readonly string[]).includes(p)) {
      throw new Error(`unknown permission "${p}"; known permissions are ${PERMISSIONS.join(", ")}`);
    }
  }
  if (await pathExists(dir)) {
    const entries = await fsp.readdir(dir);
    if (entries.length > 0 && !options.force) {
      throw new Error(`${dir} already exists and is not empty; pass --force to add files without overwriting`);
    }
  }
  await fsp.mkdir(dir, { recursive: true });

  const written: string[] = [];
  const writeNew = async (rel: string, content: string) => {
    const target = path.join(dir, rel);
    if (await pathExists(target)) return;
    await writeUtf8NoBom(target, content);
    written.push(rel);
  };

  const manifest = renderManifest(options, pluginName);
  await writeNew("plugin.json", JSON.stringify(manifest, null, 2) + "\n");
  await writeNew("main.lua", renderMainLua(options, pluginName));
  if (options.editorFiles ?? true) {
    for (const [rel, content] of Object.entries(renderEditorFiles(pluginName, options.name ?? pluginName))) {
      await fsp.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await writeNew(rel, content);
    }
  }
  if (!(await pathExists(path.join(dir, ".luarc.json")))) {
    await writeLuarc(dir, {
      stubsDir: options.stubsDir,
      resolveFrom: options.resolveFrom,
      env: options.env,
      globals: options.prettyUi ? [PRETTY_UI_PLUGIN_NAME] : [],
    });
    written.push(".luarc.json");
  }
  if (options.agentFiles ?? true) {
    await copyTree(AGENT_FILES_DIR, dir, written, "");
  }
  return { dir, pluginName, files: written.sort(), manifest };
}
