// rs3dev init: create a small, readable plugin that passes validate and
// preflight out of the box. Generated Lua is plain and commented because
// moderation rejects code that is hard to follow.

import * as path from "node:path";
import { promises as fsp } from "node:fs";
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
  /** Copy AGENTS.md, Cursor rules and Claude Code skills into the plugin folder. Default true. */
  agentFiles?: boolean;
  /** Stubs folder for .luarc.json; resolved automatically when omitted. */
  stubsDir?: string;
  /** Allow writing into a non-empty folder (existing files are never overwritten). */
  force?: boolean;
}

export interface ScaffoldResult {
  dir: string;
  pluginName: string;
  files: string[];
  manifest: PluginManifest;
}

/** Identifier used for the PrettyUI dependency. Must match the installed plugin's folder name. */
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
  if (optional.includes("httpAccess") || required.includes("httpAccess")) {
    manifest.urls = { wiki: "https://runescape.wiki/" };
  }
  return manifest;
}

/** Produce the commented main.lua for a new plugin. */
export function renderMainLua(options: ScaffoldOptions, pluginName: string): string {
  const displayName = options.name ?? pluginName;
  const ident = luaIdentifier(pluginName);
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
    "-- Reference names for event subscriptions, kept together so PluginShutdown can",
    "-- unsubscribe every one of them.",
    `local EVENT_REFS = {`,
    `    logic = "${ident}.logic",`,
    `}`,
    "",
  );

  if (options.prettyUi) {
    push(
      `-- ${PRETTY_UI_PLUGIN_NAME} is listed in requiredDependencies, so the client loads it first and`,
      `-- exposes its exported table as the global ${PRETTY_UI_PLUGIN_NAME}. Keep calls to it in one`,
      "-- place so the rest of the plugin does not depend on its API shape.",
      `local prettyUi = ${PRETTY_UI_PLUGIN_NAME}`,
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
    push(
      `-- Required permissions (${[...required].join(", ")}) are granted before the plugin is enabled,`,
      "-- so no runtime check is needed for them.",
      "",
    );
  }

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
    '        label.content = formatStr("Hello from ' + displayName + ' ({} ticks)", ticks)',
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
  return lines.join("\n") + "\n";
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
  if (!(await pathExists(path.join(dir, ".luarc.json")))) {
    await writeLuarc(dir, options.stubsDir);
    written.push(".luarc.json");
  }
  if (options.agentFiles ?? true) {
    await copyTree(AGENT_FILES_DIR, dir, written, "");
  }
  return { dir, pluginName, files: written.sort(), manifest };
}
