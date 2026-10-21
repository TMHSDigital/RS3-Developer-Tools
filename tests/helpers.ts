// Shared helpers for the repository-level tests: a small YAML-frontmatter
// reader (the subset used by SKILL.md and .mdc files) and file listing.

import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type Frontmatter = Record<string, string | string[] | boolean>;

/** Parse the frontmatter block at the top of a Markdown or .mdc file. */
export function parseFrontmatter(text: string): { data: Frontmatter; body: string } {
  const normalised = text.replace(/\r\n/g, "\n");
  if (!normalised.startsWith("---\n")) throw new Error("file does not start with a frontmatter block");
  const end = normalised.indexOf("\n---\n", 4);
  if (end === -1) throw new Error("frontmatter block is not closed");
  const block = normalised.slice(4, end).split("\n");
  const data: Frontmatter = {};
  let currentList: string | undefined;
  for (const rawLine of block) {
    const line = rawLine.replace(/\s+$/, "");
    if (line.trim() === "") continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && currentList) {
      (data[currentList] as string[]).push(unquote(item[1]!));
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`unparseable frontmatter line: ${line}`);
    const key = kv[1]!;
    const value = kv[2]!.trim();
    currentList = undefined;
    if (value === "") {
      data[key] = [];
      currentList = key;
    } else if (value === "[]") {
      data[key] = [];
    } else if (value.startsWith("[")) {
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((v) => unquote(v.trim()))
        .filter(Boolean);
    } else if (value === "true" || value === "false") {
      data[key] = value === "true";
    } else {
      data[key] = unquote(value);
    }
  }
  return { data, body: normalised.slice(end + 5) };
}

function unquote(value: string): string {
  return value.replace(/^["'](.*)["']$/, "$1");
}

export async function listFiles(dir: string, predicate: (rel: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string, rel: string): Promise<void> {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), next);
      else if (predicate(next)) out.push(next);
    }
  }
  await walk(dir, "");
  return out.sort();
}

export async function readText(rel: string): Promise<string> {
  return fsp.readFile(path.join(repoRoot, rel), "utf8");
}

export async function readJson<T = unknown>(rel: string): Promise<T> {
  return JSON.parse(await readText(rel)) as T;
}
