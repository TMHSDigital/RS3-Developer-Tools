// Build the zip that is uploaded to mod.io: plugin.json and main.lua at the
// archive root, other plugin files alongside, development artefacts excluded.
// Timestamps are fixed so the same tree produces the same archive.

import * as path from "node:path";
import { promises as fsp } from "node:fs";
import { zipSync, type Zippable } from "fflate";
import { listFilesRecursive, pathExists } from "./fs.js";
import { isPlaceholderEmail, readManifest } from "./manifest.js";
import { loadArtifactFilter } from "./ignore.js";
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
  /** Warn when the uncompressed content exceeds this many bytes. Default 10 MB. */
  maxBytes?: number;
}

export interface PackageEntry {
  path: string;
  bytes: number;
}

export interface PackageResult {
  outFile: string;
  files: string[];
  /** Compressed archive size. */
  bytes: number;
  /** Uncompressed size of every entry. */
  contentBytes: number;
  /** Every entry with its uncompressed size, largest first. */
  entries: PackageEntry[];
  /** Size and content warnings worth reading before uploading. */
  warnings: string[];
  /** The steps between this archive and a submission, in order. */
  checklist: string[];
  reminder: string;
}

export const SUBMISSION_REMINDER =
  `Upload the archive manually on mod.io and check it against the official submission page: ${DOCS.submission}. ` +
  "The mod.io API is not available for RuneScape plugins, so there is no automated upload.";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The checklist a human reads after packaging; the prepare_submission prompt and the skill carry the same steps. */
export function submissionChecklist(result: { outFile: string; bytes: number; files: string[]; version: string; name: string }): string[] {
  return [
    `1. Archive: ${result.outFile} (${formatBytes(result.bytes)}, ${result.files.length} files) with plugin.json and main.lua at the root. Inspect it with rs3dev package --verify "${result.outFile}" or --list.`,
    `2. Submitting ${result.name} version ${result.version}; bump version in plugin.json before every resubmission.`,
    `3. Write the mod.io description following ${DOCS.submission.replace("process.html", "example.html")} and confirm the legal requirements on ${DOCS.submission.replace("process.html", "index.html")}.`,
    `4. Test one last time from a clean reload in the client (rs3dev sync, prl <name>, every feature, then poff <name> leaves nothing behind).`,
    `5. Upload manually on mod.io: ${DOCS.submission}. Moderators read the code; keep it readable.`,
  ];
}

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

  const excluded = await loadArtifactFilter(source);
  const files = (await listFilesRecursive(source)).filter((rel) => !excluded(rel));
  const entries: Zippable = {};
  const sizes: PackageEntry[] = [];
  const fixedDate = new Date(Date.UTC(2020, 0, 1));
  for (const rel of files) {
    const data =
      rel === "plugin.json"
        ? new TextEncoder().encode(renderShippedManifest(manifest as unknown as Record<string, unknown>))
        : new Uint8Array(await fsp.readFile(path.join(source, ...rel.split("/"))));
    entries[rel] = [data, { mtime: fixedDate }];
    sizes.push({ path: rel, bytes: data.byteLength });
  }
  const zipped = zipSync(entries, { level: 6, mtime: fixedDate });
  sizes.sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : 1));
  const contentBytes = sizes.reduce((n, e) => n + e.bytes, 0);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const warnings: string[] = [];
  if (contentBytes > maxBytes) {
    warnings.push(
      `the plugin content is ${formatBytes(contentBytes)} (limit ${formatBytes(maxBytes)}); the largest files are ${sizes
        .slice(0, 3)
        .map((e) => `${e.path} (${formatBytes(e.bytes)})`)
        .join(", ")}. Optimise resources before uploading: ${DOCS.structure}`,
    );
  }
  const readme = files.find((f) => /^readme\.md$/i.test(f));
  if (readme) warnings.push(`${readme} ships in the archive; moderators and users see it, so make sure it is written for them (add it to .rs3ignore to leave it out)`);

  const safeVersion = manifest.version.replace(/[^0-9A-Za-z.+-]/g, "_");
  // Default to dist/ under the current directory. When that is the plugin
  // folder itself (the quick start does cd my-plugin), dist/ is a dev artefact
  // that sync, watch and package all ignore, so the zip never re-syncs itself.
  const outFile = path.resolve(
    options.outFile ?? path.join(options.outDir ?? path.join(process.cwd(), "dist"), `${path.basename(source)}-${safeVersion}.zip`),
  );
  if ((await pathExists(outFile)) && !options.overwrite) {
    throw new Error(`${outFile} already exists; pass --overwrite to replace it`);
  }
  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  await fsp.writeFile(outFile, zipped);
  const result = { outFile, files, bytes: zipped.byteLength };
  return {
    ...result,
    contentBytes,
    entries: sizes,
    warnings,
    checklist: submissionChecklist({ ...result, version: manifest.version, name: manifest.name }),
    reminder: SUBMISSION_REMINDER,
  };
}
