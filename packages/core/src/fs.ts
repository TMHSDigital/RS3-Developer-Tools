// File-system helpers shared by every package.
//
// Two rules apply everywhere in this toolkit:
//   1. Text files are written as UTF-8 without a byte-order mark. The RS3 client
//      and LuaLS both read plain UTF-8, and a BOM at the top of main.lua breaks
//      the first line of the script.
//   2. Paths are handled with node:path so they work with drive letters and
//      backslashes on Windows as well as forward slashes elsewhere.

import { promises as fsp } from "node:fs";
import * as fs from "node:fs";
import * as path from "node:path";

const UTF8_BOM = "﻿";

/** Read a text file as UTF-8, stripping a leading BOM if one is present. */
export async function readUtf8(filePath: string): Promise<string> {
  const text = await fsp.readFile(filePath, "utf8");
  return text.startsWith(UTF8_BOM) ? text.slice(1) : text;
}

/** Synchronous variant of readUtf8. */
export function readUtf8Sync(filePath: string): string {
  const text = fs.readFileSync(filePath, "utf8");
  return text.startsWith(UTF8_BOM) ? text.slice(1) : text;
}

/** Write a text file as UTF-8 without a BOM, creating parent folders as needed. */
export async function writeUtf8NoBom(filePath: string, text: string): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const clean = text.startsWith(UTF8_BOM) ? text.slice(1) : text;
  await fsp.writeFile(filePath, clean, { encoding: "utf8" });
}

/** Synchronous variant used by the stubs generator, which writes many small files. */
export function writeUtf8NoBomSync(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const clean = text.startsWith(UTF8_BOM) ? text.slice(1) : text;
  fs.writeFileSync(filePath, clean, { encoding: "utf8" });
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fsp.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** Convert any path to forward slashes (for display, JSON, and LuaLS config). */
export function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/").replace(/\\/g, "/");
}

/**
 * True when target is root itself or lives underneath it.
 * Both paths are resolved first so ".." segments and relative paths cannot escape.
 * Comparison is case-insensitive on Windows because NTFS is.
 */
export function isInside(root: string, target: string): boolean {
  const rootAbs = path.resolve(root);
  const targetAbs = path.resolve(target);
  const normalise = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
  const rel = path.relative(normalise(rootAbs), normalise(targetAbs));
  if (rel === "") return true;
  if (path.isAbsolute(rel)) return false;
  if (rel === ".." || rel.startsWith(".." + path.sep)) return false;
  return true;
}

/**
 * Recursively list files under dir, returning paths relative to dir with
 * forward slashes, sorted for deterministic output.
 */
export async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string, prefix: string): Promise<void> {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(current, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  }
  await walk(dir, "");
  return out;
}
