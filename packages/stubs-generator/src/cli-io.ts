// Disk I/O for the generator: write the exact output set, or diff it for --check.

import * as path from "node:path";
import { promises as fsp } from "node:fs";
import { listFilesRecursive, readUtf8, writeUtf8NoBom, pathExists } from "@tmhs/rs3-devtools-core";

/** Write the generated files, removing stale stub files so the output set is exact. */
export async function writeOutput(
  outDir: string,
  files: Record<string, string>,
): Promise<{ written: number; removed: number }> {
  const stubsDir = path.join(outDir, "stubs");
  let removed = 0;
  if (await pathExists(stubsDir)) {
    for (const rel of await listFilesRecursive(stubsDir)) {
      if (!files[`stubs/${rel}`]) {
        await fsp.rm(path.join(stubsDir, rel));
        removed++;
      }
    }
  }
  let written = 0;
  for (const rel of Object.keys(files).sort()) {
    await writeUtf8NoBom(path.join(outDir, ...rel.split("/")), files[rel]!);
    written++;
  }
  return { written, removed };
}

/** Compare generated files with what is on disk. Returns the differing paths. */
export async function diffOutput(outDir: string, files: Record<string, string>): Promise<string[]> {
  const differing: string[] = [];
  for (const rel of Object.keys(files).sort()) {
    const target = path.join(outDir, ...rel.split("/"));
    if (!(await pathExists(target))) {
      differing.push(rel + " (missing)");
      continue;
    }
    if ((await readUtf8(target)) !== files[rel]) differing.push(rel);
  }
  const stubsDir = path.join(outDir, "stubs");
  if (await pathExists(stubsDir)) {
    for (const rel of await listFilesRecursive(stubsDir)) {
      if (!files[`stubs/${rel}`]) differing.push(`stubs/${rel} (stale)`);
    }
  }
  return differing;
}
