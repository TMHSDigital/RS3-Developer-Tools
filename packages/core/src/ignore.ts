// One predicate for what never ships: package, sync and watch all ask it.
//
// Two layers: isDevArtifact (manifest.ts) names the toolkit's own files and
// the usual development folders; this module adds operating system and editor
// junk and an optional .rs3ignore in the plugin root with gitignore syntax
// (comments, *, **, ?, a trailing slash for folders, a leading slash to anchor
// at the root, and ! to re-include).

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { pathExists, readUtf8 } from "./fs.js";
import { isDevArtifact } from "./manifest.js";

export const IGNORE_FILE_NAME = ".rs3ignore";

/** File names and extensions that are never plugin content. */
const JUNK_NAMES = new Set(["thumbs.db", "desktop.ini", ".ds_store"]);
const JUNK_SUFFIXES = [".bak", ".orig", ".swp", ".swo", ".psd", ".xcf", ".log", ".tmp"];
/** Folders that hold tests, builds or editor state rather than plugin files. */
const JUNK_FOLDERS = new Set(["__tests__", "spec", "build", "coverage"]);

/** Operating system and editor leftovers, independent of any .rs3ignore. */
export function isJunk(relPath: string): boolean {
  const parts = relPath.split("/");
  if (parts.slice(0, -1).some((p) => JUNK_FOLDERS.has(p.toLowerCase()))) return true;
  const base = (parts[parts.length - 1] ?? "").toLowerCase();
  if (JUNK_NAMES.has(base)) return true;
  if (base.endsWith("~")) return true;
  return JUNK_SUFFIXES.some((s) => base.endsWith(s));
}

interface IgnoreRule {
  regex: RegExp;
  negate: boolean;
  directoryOnly: boolean;
}

/** Translate one gitignore-style pattern into a regex over "a/b/c" paths. */
function compilePattern(raw: string): IgnoreRule | undefined {
  let pattern = raw.trim();
  if (!pattern || pattern.startsWith("#")) return undefined;
  let negate = false;
  if (pattern.startsWith("!")) {
    negate = true;
    pattern = pattern.slice(1);
  }
  let directoryOnly = false;
  if (pattern.endsWith("/")) {
    directoryOnly = true;
    pattern = pattern.slice(0, -1);
  }
  const anchored = pattern.startsWith("/") || pattern.slice(0, -1).includes("/");
  pattern = pattern.replace(/^\//, "");
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
        if (pattern[i + 1] === "/") i++;
      } else re += "[^/]*";
    } else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  // Anchored patterns match from the root; others match at any depth. Either
  // way a match on a folder covers everything below it.
  const body = anchored ? `^${re}` : `(^|/)${re}`;
  return { regex: new RegExp(`${body}(/|$)`), negate, directoryOnly };
}

export class IgnoreMatcher {
  private readonly rules: IgnoreRule[];

  constructor(patterns: string[]) {
    this.rules = patterns.map(compilePattern).filter((r): r is IgnoreRule => r !== undefined);
  }

  /** True when the relative path (forward slashes) is excluded by the rules. */
  ignores(relPath: string): boolean {
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.directoryOnly && !relPath.includes("/") && !rule.regex.test(relPath + "/")) {
        // A folder-only pattern cannot match a file at the root by name alone.
        continue;
      }
      if (rule.regex.test(relPath)) ignored = !rule.negate;
    }
    return ignored;
  }

  get size(): number {
    return this.rules.length;
  }
}

export function parseIgnoreFile(text: string): IgnoreMatcher {
  return new IgnoreMatcher(text.split(/\r?\n/));
}

/** Everything the three commands leave out, with the plugin's own .rs3ignore applied. */
export type ArtifactFilter = (relPath: string) => boolean;

function combine(matcher: IgnoreMatcher | undefined): ArtifactFilter {
  return (rel) => isDevArtifact(rel) || isJunk(rel) || Boolean(matcher?.ignores(rel));
}

/** Async form for package and sync. */
export async function loadArtifactFilter(pluginDir: string): Promise<ArtifactFilter> {
  const file = path.join(pluginDir, IGNORE_FILE_NAME);
  if (!(await pathExists(file))) return combine(undefined);
  return combine(parseIgnoreFile(await readUtf8(file)));
}

/** Sync form for the watcher, whose ignore callback cannot await. */
export function loadArtifactFilterSync(pluginDir: string): ArtifactFilter {
  try {
    return combine(parseIgnoreFile(readFileSync(path.join(pluginDir, IGNORE_FILE_NAME), "utf8")));
  } catch {
    return combine(undefined);
  }
}
