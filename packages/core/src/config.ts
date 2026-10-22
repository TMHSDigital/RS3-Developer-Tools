// Optional rs3dev.json in a plugin folder: reviewed preflight exceptions,
// thresholds, the dev_plugins root and the package output folder. Flags on
// the command line win over the file. The file is a development artefact and
// never reaches dev_plugins or the zip (see isDevArtifact).

import * as path from "node:path";
import { loadRs3devSchema, type Rs3devConfig } from "@tmhs/rs3-plugin-schema";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { DOCS, type Finding } from "./findings.js";
import { pathExists, readUtf8 } from "./fs.js";

export const CONFIG_FILE_NAME = "rs3dev.json";

export interface ProjectConfigResult {
  /** Parsed configuration, or an empty object when the file is absent or invalid. */
  config: Rs3devConfig;
  /** Absolute path of the file when it exists. */
  file?: string;
  /** Problems with the file itself; an invalid file is reported, never silently ignored. */
  findings: Finding[];
}

let validator: ValidateFunction | undefined;

function validate(): ValidateFunction {
  if (!validator) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    validator = ajv.compile(loadRs3devSchema());
  }
  return validator;
}

function describe(error: ErrorObject): string {
  const where = error.instancePath ? error.instancePath.replace(/^\//, "").replace(/\//g, ".") : "(root)";
  return `${where} ${error.message ?? "is invalid"}`;
}

/** Read and validate <pluginDir>/rs3dev.json. A missing file is not a finding. */
export async function loadProjectConfig(pluginDir: string): Promise<ProjectConfigResult> {
  const file = path.join(path.resolve(pluginDir), CONFIG_FILE_NAME);
  if (!(await pathExists(file))) return { config: {}, findings: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readUtf8(file));
  } catch (error) {
    return {
      config: {},
      file,
      findings: [
        {
          level: "error",
          code: "config-json",
          message: `${CONFIG_FILE_NAME} is not valid JSON: ${(error as Error).message}`,
          file: CONFIG_FILE_NAME,
          docsUrl: DOCS.config,
        },
      ],
    };
  }
  const check = validate();
  if (!check(parsed)) {
    const problems = (check.errors ?? []).map(describe).join("; ");
    return {
      config: {},
      file,
      findings: [
        {
          level: "error",
          code: "config-schema",
          message: `${CONFIG_FILE_NAME} does not match the schema: ${problems}`,
          file: CONFIG_FILE_NAME,
          docsUrl: DOCS.config,
        },
      ],
    };
  }
  return { config: parsed as Rs3devConfig, file, findings: [] };
}

/** Comment marker that suppresses a finding on the next line (or the same line). */
export const INLINE_IGNORE = /rs3dev-ignore(?:\s+([a-z][a-z0-9-]*(?:\s*,\s*[a-z][a-z0-9-]*)*))?/;

/**
 * Codes suppressed by "-- rs3dev-ignore <code>[, <code>]" comments, keyed by
 * the line they apply to (the comment's own line and the one after it). A bare
 * "rs3dev-ignore" suppresses every code on that line.
 */
export function inlineIgnores(source: string): Map<number, Set<string> | "all"> {
  const result = new Map<number, Set<string> | "all">();
  const lines = source.split(/\r?\n/);
  lines.forEach((text, index) => {
    const comment = text.indexOf("--");
    if (comment === -1) return;
    const m = INLINE_IGNORE.exec(text.slice(comment));
    if (!m) return;
    const value: Set<string> | "all" = m[1] ? new Set(m[1].split(",").map((c) => c.trim())) : "all";
    const lineNumber = index + 1;
    const merge = (at: number) => {
      const existing = result.get(at);
      if (existing === "all" || value === "all") result.set(at, "all");
      else if (existing) for (const c of value) existing.add(c);
      else result.set(at, new Set(value));
    };
    merge(lineNumber);
    // A comment on its own line applies to the statement below it.
    if (text.slice(0, comment).trim() === "") merge(lineNumber + 1);
  });
  return result;
}

/** True when the finding is covered by an inline marker in its file. */
export function isInlineIgnored(finding: Finding, ignoresByFile: Map<string, Map<number, Set<string> | "all">>): boolean {
  if (!finding.file || !finding.line) return false;
  const marks = ignoresByFile.get(finding.file)?.get(finding.line);
  if (!marks) return false;
  return marks === "all" || marks.has(finding.code);
}
