// Programmatic access to the plugin.json JSON Schema.
//
// The schema file is the source of truth; this module only loads it and
// exposes the permission list so other packages do not duplicate the enum.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_SCHEMA_PATH = fileURLToPath(new URL("../plugin.schema.json", import.meta.url));

/** The known permission names, in the order the documentation lists them. */
export const PERMISSIONS = ["httpAccess", "chatAccess", "trackingAccess"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface PluginManifest {
  $schema?: string;
  name: string;
  version: string;
  contactEmailAddress: string;
  requiredDependencies?: string[] | Record<string, string>;
  optionalDependencies?: string[] | Record<string, string>;
  requiredPermissions?: Permission[];
  optionalPermissions?: Permission[];
  urls?: Record<string, string>;
  hasSettingsIcon?: boolean;
  hasRibbonIcon?: boolean;
}

let cached: Record<string, unknown> | undefined;

/** Load and parse the schema once. */
export function loadPluginSchema(): Record<string, unknown> {
  if (!cached) {
    cached = JSON.parse(readFileSync(PLUGIN_SCHEMA_PATH, "utf8")) as Record<string, unknown>;
  }
  return cached;
}

/** Schema for the optional rs3dev.json project configuration in a plugin folder. */
export const RS3DEV_SCHEMA_PATH = fileURLToPath(new URL("../rs3dev.schema.json", import.meta.url));

export interface Rs3devConfig {
  $schema?: string;
  preflight?: {
    ignore?: string[];
    maxLineLength?: number;
    minCommentRatio?: number;
  };
  sync?: {
    root?: string;
    prune?: boolean;
  };
  package?: {
    outDir?: string;
  };
}

let cachedConfigSchema: Record<string, unknown> | undefined;

/** Load and parse the rs3dev.json schema once. */
export function loadRs3devSchema(): Record<string, unknown> {
  if (!cachedConfigSchema) {
    cachedConfigSchema = JSON.parse(readFileSync(RS3DEV_SCHEMA_PATH, "utf8")) as Record<string, unknown>;
  }
  return cachedConfigSchema;
}

/** Directory holding the schema and the VS Code settings sample. */
export const SCHEMA_PACKAGE_DIR = path.dirname(PLUGIN_SCHEMA_PATH);
