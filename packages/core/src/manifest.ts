// plugin.json validation: JSON Schema (draft 2020-12) plus structural checks
// on the plugin folder itself.

import * as path from "node:path";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import formatsPluginImport, { type FormatsPlugin } from "ajv-formats";
import { loadPluginSchema, type PluginManifest } from "@tmhs/rs3-plugin-schema";
import { DOCS, type Finding } from "./findings.js";
import { isDirectory, pathExists, readUtf8, listFilesRecursive } from "./fs.js";
import { promises as fsp } from "node:fs";

// ajv-formats ships a CommonJS build; under Node ESM the plugin may sit on .default.
const addFormats: FormatsPlugin =
  (formatsPluginImport as unknown as { default?: FormatsPlugin }).default ??
  (formatsPluginImport as unknown as FormatsPlugin);

let compiled: ValidateFunction | undefined;

function validator(): ValidateFunction {
  if (compiled) return compiled;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(loadPluginSchema());
  compiled = validate;
  return validate;
}

function describeError(err: ErrorObject): string {
  const where = err.instancePath ? err.instancePath.replace(/^\//, "").replace(/\//g, ".") : "manifest";
  switch (err.keyword) {
    case "required":
      return `${where} is missing required field "${(err.params as { missingProperty: string }).missingProperty}"`;
    case "additionalProperties":
      return `${where} has unknown field "${(err.params as { additionalProperty: string }).additionalProperty}"`;
    case "enum":
      return `${where} must be one of ${(err.params as { allowedValues: string[] }).allowedValues.join(", ")}`;
    case "format":
      return `${where} must be a valid ${(err.params as { format: string }).format}`;
    case "pattern":
      return `${where} does not match the required pattern`;
    case "oneOf":
      return `${where} must be either an array of plugin names or a map of alias to plugin name`;
    case "propertyNames":
      return `${where} has a key that is not a valid Lua identifier`;
    default:
      return `${where} ${err.message ?? "is invalid"}`;
  }
}

/** Validate a parsed manifest object against the schema. */
export function validateManifestObject(manifest: unknown): Finding[] {
  const validate = validator();
  const findings: Finding[] = [];
  if (!validate(manifest)) {
    const seen = new Set<string>();
    for (const err of validate.errors ?? []) {
      // The oneOf branch reports nested errors for both alternatives; keep the summary only.
      if (err.instancePath.match(/Dependencies\/?/) && err.keyword !== "oneOf" && err.schemaPath.includes("oneOf")) continue;
      const message = describeError(err);
      if (seen.has(message)) continue;
      seen.add(message);
      findings.push({ level: "error", code: "manifest-schema", message, file: "plugin.json", docsUrl: DOCS.manifest });
    }
  }
  return findings;
}

export interface ManifestReadResult {
  manifest?: PluginManifest;
  findings: Finding[];
}

/** Read and parse plugin.json from a plugin folder, reporting problems as findings. */
export async function readManifest(pluginDir: string): Promise<ManifestReadResult> {
  const file = path.join(pluginDir, "plugin.json");
  if (!(await pathExists(file))) {
    return {
      findings: [{ level: "error", code: "manifest-missing", message: "plugin.json not found in the plugin folder", file: "plugin.json", docsUrl: DOCS.structure }],
    };
  }
  const raw = await fsp.readFile(file);
  const findings: Finding[] = [];
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    findings.push({ level: "warning", code: "utf8-bom", message: "plugin.json starts with a UTF-8 byte-order mark; save it as UTF-8 without BOM", file: "plugin.json", docsUrl: DOCS.tutorialFiles });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8").replace(/^﻿/, ""));
  } catch (error) {
    findings.push({ level: "error", code: "manifest-json", message: `plugin.json is not valid JSON: ${(error as Error).message}`, file: "plugin.json", docsUrl: DOCS.manifest });
    return { findings };
  }
  findings.push(...validateManifestObject(parsed));
  return { manifest: parsed as PluginManifest, findings };
}

/** Domains that only ever hold placeholder addresses. */
const PLACEHOLDER_DOMAINS = ["example.com", "example.org", "example.net"];

/**
 * True when a contactEmailAddress is a placeholder: an example.* domain or a
 * "change-me" marker. Jagex requires a real contact address, so preflight warns
 * and package refuses.
 */
export function isPlaceholderEmail(email: string | undefined): boolean {
  if (!email) return true;
  const value = email.trim().toLowerCase();
  if (value.includes("change-me")) return true;
  const at = value.lastIndexOf("@");
  if (at === -1) return true;
  const domain = value.slice(at + 1);
  return PLACEHOLDER_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));
}

/** Files and folders that are development artefacts rather than plugin content. */
export function isDevArtifact(relPath: string): boolean {
  const parts = relPath.split("/");
  if (parts.some((p) => p.startsWith(".") && p !== "." && p !== "..")) return true;
  if (parts.includes("node_modules") || parts.includes("dist") || parts.includes("tests")) return true;
  const base = parts[parts.length - 1] ?? "";
  if (/\.zip$/i.test(base)) return true;
  if (["AGENTS.md", "CLAUDE.md", "package.json", "package-lock.json"].includes(base)) return true;
  return false;
}

/** Validate the whole plugin folder: manifest, required files, and encoding. */
export async function validatePluginDir(pluginDir: string): Promise<{ manifest?: PluginManifest; findings: Finding[] }> {
  const findings: Finding[] = [];
  if (!(await isDirectory(pluginDir))) {
    return { findings: [{ level: "error", code: "plugin-dir", message: `${pluginDir} is not a directory`, docsUrl: DOCS.structure }] };
  }
  const folderName = path.basename(path.resolve(pluginDir));
  if (/\s/.test(folderName)) {
    findings.push({ level: "warning", code: "folder-name", message: `the plugin folder name "${folderName}" contains whitespace; the folder name is the identifier used by the console commands`, docsUrl: DOCS.tutorialFiles });
  }
  const { manifest, findings: manifestFindings } = await readManifest(pluginDir);
  findings.push(...manifestFindings);

  const mainLua = path.join(pluginDir, "main.lua");
  if (!(await pathExists(mainLua))) {
    findings.push({ level: "error", code: "main-missing", message: "main.lua not found in the plugin folder", file: "main.lua", docsUrl: DOCS.structure });
  } else {
    const head = Buffer.from(await fsp.readFile(mainLua)).subarray(0, 3);
    if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
      findings.push({ level: "error", code: "utf8-bom", message: "main.lua starts with a UTF-8 byte-order mark, which breaks the first line of the script", file: "main.lua", docsUrl: DOCS.tutorialFiles });
    }
  }

  // Every require("x/y") must point at an existing Lua file inside the plugin.
  for (const rel of await listFilesRecursive(pluginDir)) {
    if (!rel.endsWith(".lua") || isDevArtifact(rel)) continue;
    const source = await readUtf8(path.join(pluginDir, rel));
    for (const m of source.matchAll(/\brequire\s*\(?\s*["']([^"']+)["']/g)) {
      const target = m[1]!;
      if (target.includes("..")) {
        findings.push({ level: "error", code: "require-path", message: `require("${target}") leaves the plugin folder; paths are relative to the plugin root`, file: rel, docsUrl: DOCS.dependencies });
        continue;
      }
      const candidate = path.join(pluginDir, ...target.split("/")) + ".lua";
      if (!(await pathExists(candidate))) {
        findings.push({ level: "error", code: "require-missing", message: `require("${target}") does not match a file (expected ${target}.lua relative to the plugin root)`, file: rel, docsUrl: DOCS.dependencies });
      }
    }
  }

  if (manifest) {
    const perms = [...(manifest.requiredPermissions ?? []), ...(manifest.optionalPermissions ?? [])];
    const dup = perms.filter((p, i) => perms.indexOf(p) !== i);
    for (const p of new Set(dup)) {
      findings.push({ level: "warning", code: "permission-duplicate", message: `permission "${p}" is listed as both required and optional`, file: "plugin.json", docsUrl: DOCS.permissions });
    }
    if (manifest.urls && Object.keys(manifest.urls).length > 0 && !perms.includes("httpAccess")) {
      findings.push({ level: "warning", code: "urls-without-http", message: "urls are declared but httpAccess is not requested; the URLs cannot be used", file: "plugin.json", docsUrl: DOCS.http });
    }
  }
  return { manifest, findings };
}
