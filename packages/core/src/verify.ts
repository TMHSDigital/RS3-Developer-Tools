// Verify an archive built by any tool: the zip is what moderators receive,
// so it, not the folder, is the thing to check before uploading. Findings use
// the same shape and codes style as validate so the CLI prints them alike.

import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { unzipSync } from "fflate";
import { DOCS, type Finding } from "./findings.js";
import { isJunk } from "./ignore.js";
import { requireCalls, scanLua } from "./lua-scan.js";
import { isDevArtifact, isPlaceholderEmail, validateManifestObject } from "./manifest.js";
import type { PackageEntry } from "./package.js";

export interface VerifyResult {
  archive: string;
  bytes: number;
  entries: PackageEntry[];
  findings: Finding[];
}

/** Inspect a plugin zip without extracting it to disk. */
export async function verifyArchive(zipPath: string): Promise<VerifyResult> {
  const archive = path.resolve(zipPath);
  const raw = new Uint8Array(await fsp.readFile(archive));
  const findings: Finding[] = [];
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(raw);
  } catch (error) {
    return {
      archive,
      bytes: raw.byteLength,
      entries: [],
      findings: [
        { level: "error", code: "archive-unreadable", message: `${archive} is not a zip archive: ${(error as Error).message}`, docsUrl: DOCS.submission },
      ],
    };
  }
  const names = Object.keys(unzipped)
    .filter((n) => !n.endsWith("/"))
    .map((n) => n.replace(/\\/g, "/"))
    .sort();
  const entries: PackageEntry[] = names
    .map((n) => ({ path: n, bytes: unzipped[n]!.byteLength }))
    .sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : 1));
  const decode = (n: string) => new TextDecoder("utf-8").decode(unzipped[n]!);

  // Root layout: plugin.json and main.lua must sit at the archive root, not inside a folder.
  const nested = names.find((n) => /(^|\/)plugin\.json$/.test(n) && n !== "plugin.json");
  if (!names.includes("plugin.json")) {
    findings.push({
      level: "error",
      code: "archive-root",
      message: nested
        ? `plugin.json sits at ${nested}; the archive must contain the plugin files at its root, not inside a folder`
        : "plugin.json is missing from the archive root",
      file: "plugin.json",
      docsUrl: DOCS.structure,
    });
  }
  if (!names.includes("main.lua")) {
    const nestedMain = names.find((n) => /(^|\/)main\.lua$/.test(n));
    findings.push({
      level: "error",
      code: "archive-root",
      message: nestedMain ? `main.lua sits at ${nestedMain}; it must be at the archive root` : "main.lua is missing from the archive root",
      file: "main.lua",
      docsUrl: DOCS.structure,
    });
  }

  // Manifest content.
  let manifest: Record<string, unknown> | undefined;
  if (names.includes("plugin.json")) {
    const text = decode("plugin.json");
    if (text.charCodeAt(0) === 0xfeff)
      findings.push({
        level: "warning",
        code: "utf8-bom",
        message: "plugin.json starts with a UTF-8 byte-order mark",
        file: "plugin.json",
        docsUrl: DOCS.tutorialFiles,
      });
    try {
      manifest = JSON.parse(text.replace(/^﻿/, "")) as Record<string, unknown>;
    } catch (error) {
      findings.push({
        level: "error",
        code: "manifest-json",
        message: `plugin.json is not valid JSON: ${(error as Error).message}`,
        file: "plugin.json",
        docsUrl: DOCS.manifest,
      });
    }
    if (manifest) {
      if ("$schema" in manifest) {
        findings.push({
          level: "warning",
          code: "archive-schema-key",
          message: "plugin.json still carries the editor-only $schema key; rs3dev package strips it",
          file: "plugin.json",
          docsUrl: DOCS.manifest,
        });
        const { $schema: _dropped, ...rest } = manifest;
        manifest = rest;
      }
      findings.push(...validateManifestObject(manifest));
      const email = manifest.contactEmailAddress;
      if (typeof email === "string" && isPlaceholderEmail(email)) {
        findings.push({
          level: "error",
          code: "placeholder-email",
          message: `contactEmailAddress "${email}" is a placeholder; Jagex requires a real address`,
          file: "plugin.json",
          docsUrl: DOCS.manifest,
        });
      }
    }
  }

  // Development artefacts and junk that should never have been zipped.
  for (const n of names) {
    if (isDevArtifact(n) || isJunk(n)) {
      findings.push({
        level: "warning",
        code: "archive-dev-artifact",
        message: `${n} is a development artefact or junk file; rebuild with rs3dev package or add it to .rs3ignore`,
        file: n,
        docsUrl: DOCS.structure,
      });
    }
  }

  // Every require target must resolve inside the archive.
  const luaFiles = names.filter((n) => n.endsWith(".lua"));
  for (const n of luaFiles) {
    for (const call of requireCalls(scanLua(decode(n)))) {
      const target = call.target.replace(/\./g, "/") + ".lua";
      if (!names.includes(target)) {
        findings.push({
          level: "error",
          code: "archive-require",
          message: `${n} requires "${call.target}" but ${target} is not in the archive`,
          file: n,
          line: call.line,
          docsUrl: DOCS.dependencies,
        });
      }
    }
  }
  if (luaFiles.length === 0) findings.push({ level: "error", code: "archive-empty", message: "the archive contains no Lua files", docsUrl: DOCS.structure });

  return { archive, bytes: raw.byteLength, entries, findings };
}
