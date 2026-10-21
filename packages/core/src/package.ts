// Build the zip that is uploaded to mod.io: plugin.json and main.lua at the
// archive root, other plugin files alongside, development artefacts excluded.
// Timestamps are fixed so the same tree produces the same archive.

import * as path from "node:path";
import { promises as fsp } from "node:fs";
import { zipSync, type Zippable } from "fflate";
import { listFilesRecursive, pathExists } from "./fs.js";
import { isDevArtifact, isPlaceholderEmail, readManifest } from "./manifest.js";
import { DOCS } from "./findings.js";

export interface PackageOptions {
  /** Output file. Defaults to <plugin folder name>-<version>.zip in the current directory. */
  outFile?: string;
  /** Overwrite an existing archive. Default false. */
  overwrite?: boolean;
  /** Directory the default output is placed in. Defaults to process.cwd(). */
  outDir?: string;
  /** Package even when contactEmailAddress is a placeholder. Intended for tests only. */
  allowPlaceholderEmail?: boolean;
}

export interface PackageResult {
  outFile: string;
  files: string[];
  bytes: number;
  reminder: string;
}

export const SUBMISSION_REMINDER =
  `Upload the archive manually on mod.io and check it against the official submission page: ${DOCS.submission}. ` +
  "The mod.io API is not available for RuneScape plugins, so there is no automated upload.";

/**
 * The manifest as it should be shipped: the editor-only "$schema" key removed,
 * four-space indent, UTF-8 without BOM, trailing newline.
 */
export function renderShippedManifest(manifest: Record<string, unknown>): string {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (key === "$schema") continue;
    copy[key] = value;
  }
  return JSON.stringify(copy, null, 4) + "\n";
}

export async function packagePlugin(pluginDir: string, options: PackageOptions = {}): Promise<PackageResult> {
  const source = path.resolve(pluginDir);
  const { manifest, findings } = await readManifest(source);
  const blocking = findings.filter((f) => f.level === "error");
  if (!manifest || blocking.length > 0) {
    throw new Error(`plugin.json is not valid: ${blocking.map((f) => f.message).join("; ")}`);
  }
  if (!(await pathExists(path.join(source, "main.lua")))) {
    throw new Error("main.lua is missing; the client cannot load a plugin without it");
  }
  if (isPlaceholderEmail(manifest.contactEmailAddress) && !options.allowPlaceholderEmail) {
    throw new Error(
      `[placeholder-email] contactEmailAddress "${manifest.contactEmailAddress}" is a placeholder. ` +
        `Jagex requires a real contact address; set it in plugin.json before packaging (${DOCS.manifest}).`,
    );
  }

  const files = (await listFilesRecursive(source)).filter((rel) => !isDevArtifact(rel));
  const entries: Zippable = {};
  const fixedDate = new Date(Date.UTC(2020, 0, 1));
  for (const rel of files) {
    const data =
      rel === "plugin.json"
        ? new TextEncoder().encode(renderShippedManifest(manifest as unknown as Record<string, unknown>))
        : new Uint8Array(await fsp.readFile(path.join(source, ...rel.split("/"))));
    entries[rel] = [data, { mtime: fixedDate }];
  }
  const zipped = zipSync(entries, { level: 6, mtime: fixedDate });

  const safeVersion = manifest.version.replace(/[^0-9A-Za-z.+-]/g, "_");
  const outFile = path.resolve(
    options.outFile ?? path.join(options.outDir ?? process.cwd(), `${path.basename(source)}-${safeVersion}.zip`),
  );
  if ((await pathExists(outFile)) && !options.overwrite) {
    throw new Error(`${outFile} already exists; pass --overwrite to replace it`);
  }
  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  await fsp.writeFile(outFile, zipped);
  return { outFile, files, bytes: zipped.byteLength, reminder: SUBMISSION_REMINDER };
}
