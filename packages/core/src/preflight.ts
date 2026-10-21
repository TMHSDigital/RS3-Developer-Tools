// Static checks that catch the most common moderation and sandbox problems
// before a plugin is submitted. Every finding links to the documentation page
// that states the rule.

import * as path from "node:path";
import type { PluginManifest } from "@tmhs/rs3-plugin-schema";
import { DOCS, type Finding } from "./findings.js";
import { listFilesRecursive, readUtf8 } from "./fs.js";
import { isDevArtifact, isPlaceholderEmail, validatePluginDir } from "./manifest.js";
import { globalReads, memberChains, scanLua } from "./lua-scan.js";

/** Standard libraries and functions the plugin sandbox does not provide. */
export const FORBIDDEN_GLOBALS = ["os", "io", "debug", "load", "loadstring", "dofile"] as const;

export interface PreflightOptions {
  /** Lines longer than this count towards the minification heuristic. */
  maxLineLength?: number;
  /** Comment lines divided by code lines; below this ratio a warning is raised for files over 40 lines. */
  minCommentRatio?: number;
}

export interface PreflightResult {
  manifest?: PluginManifest;
  findings: Finding[];
  files: string[];
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

export async function preflightPlugin(pluginDir: string, options: PreflightOptions = {}): Promise<PreflightResult> {
  const maxLineLength = options.maxLineLength ?? 200;
  const minCommentRatio = options.minCommentRatio ?? 0.05;

  const { manifest, findings } = await validatePluginDir(pluginDir);
  const permissions = new Set([...(manifest?.requiredPermissions ?? []), ...(manifest?.optionalPermissions ?? [])]);
  const optionalOnly = new Set(
    (manifest?.optionalPermissions ?? []).filter((p) => !(manifest?.requiredPermissions ?? []).includes(p)),
  );
  const allowedHosts = new Set(
    Object.values(manifest?.urls ?? {})
      .map(hostOf)
      .filter((h): h is string => Boolean(h)),
  );

  const luaFiles = (await listFilesRecursive(pluginDir)).filter((rel) => rel.endsWith(".lua") && !isDevArtifact(rel));
  const usesPermissionCheck = { chatAccess: false, httpAccess: false, trackingAccess: false };

  for (const rel of luaFiles) {
    const source = await readUtf8(path.join(pluginDir, rel));
    const scan = scanLua(source);
    const reads = globalReads(scan);
    const chains = memberChains(scan);
    const chainText = chains.map((c) => c.chain);

    // Sandbox: forbidden standard libraries.
    for (const read of reads) {
      if ((FORBIDDEN_GLOBALS as readonly string[]).includes(read.name)) {
        findings.push({ level: "error", code: "sandbox-global", message: `"${read.name}" is not available to plugins and will be rejected`, file: rel, line: read.line, docsUrl: DOCS.guidelines });
      }
    }

    // Permissions: chat.
    const chatUse = chains.filter((c) => /^Chat[.:]/.test(c.chain) || /^Event\.ChatMessage\b/.test(c.chain));
    if (chatUse.length > 0 && !permissions.has("chatAccess")) {
      findings.push({ level: "error", code: "chat-permission", message: `"${chatUse[0]!.chain}" needs the chatAccess permission in plugin.json`, file: rel, line: chatUse[0]!.line, docsUrl: DOCS.chat });
    }
    // Permissions: http.
    const httpUse = chains.filter((c) => /^HTTPRequest[.:]/.test(c.chain));
    if (httpUse.length > 0 && !permissions.has("httpAccess")) {
      findings.push({ level: "error", code: "http-permission", message: `"${httpUse[0]!.chain}" needs the httpAccess permission in plugin.json`, file: rel, line: httpUse[0]!.line, docsUrl: DOCS.http });
    }
    // Permissions: tracking id.
    const trackingUse = chains.filter((c) => /^Player\.GetTrackingID\b/.test(c.chain));
    if (trackingUse.length > 0 && !permissions.has("trackingAccess")) {
      findings.push({ level: "error", code: "tracking-permission", message: `"${trackingUse[0]!.chain}" needs the trackingAccess permission in plugin.json`, file: rel, line: trackingUse[0]!.line, docsUrl: DOCS.tracking });
    }
    // Plugin.HasPermission takes the PluginPermissions enum, so a gated feature shows
    // up as a PluginPermissions.<name> chain somewhere in the file.
    for (const c of chains) {
      const m = /^PluginPermissions\.(chatAccess|httpAccess|trackingAccess)$/.exec(c.chain);
      if (m) usesPermissionCheck[m[1] as keyof typeof usesPermissionCheck] = true;
    }

    // URL literals outside the declared base URLs.
    for (const s of scan.strings) {
      const urlMatch = /https?:\/\/[^\s"'<>]+/i.exec(s.value);
      if (!urlMatch) continue;
      const host = hostOf(urlMatch[0]);
      if (!host) continue;
      if (!permissions.has("httpAccess")) {
        findings.push({ level: "warning", code: "url-without-http", message: `URL literal "${urlMatch[0]}" found but httpAccess is not requested; only Plugin.urls entries can be fetched`, file: rel, line: s.line, docsUrl: DOCS.http });
      } else if (!allowedHosts.has(host)) {
        findings.push({ level: "error", code: "url-outside-manifest", message: `URL literal "${urlMatch[0]}" points at a host that is not declared in the manifest urls`, file: rel, line: s.line, docsUrl: DOCS.http });
      }
    }

    // Readability heuristics that moderators reject: minified or obfuscated code.
    const longLines = source.split(/\r?\n/).map((l, i) => ({ l, i })).filter(({ l }) => l.length > maxLineLength);
    if (longLines.length > 0) {
      findings.push({ level: "warning", code: "long-lines", message: `${longLines.length} line(s) longer than ${maxLineLength} characters; moderators reject code that is hard to follow`, file: rel, line: longLines[0]!.i + 1, docsUrl: DOCS.moderation });
    }
    if (scan.codeLines > 40 && scan.commentLines / scan.codeLines < minCommentRatio) {
      findings.push({ level: "warning", code: "low-comment-ratio", message: `only ${scan.commentLines} comment line(s) for ${scan.codeLines} code lines; add comments that explain intent`, file: rel, docsUrl: DOCS.moderation });
    }
    const encoded = scan.strings.filter((s) => /(\\x[0-9a-fA-F]{2}){4,}|(\\\d{1,3}){4,}/.test(s.value) || /^[A-Za-z0-9+/=]{64,}$/.test(s.value));
    if (encoded.length > 0) {
      findings.push({ level: "warning", code: "encoded-string", message: "string literal looks encoded (escape sequences or base64); moderators treat obfuscated code as a rejection reason", file: rel, line: encoded[0]!.line, docsUrl: DOCS.moderation });
    }
    const charChains = chainText.filter((c) => c === "string.char").length;
    if (charChains >= 3) {
      findings.push({ level: "warning", code: "string-char-chain", message: `string.char is used ${charChains} times; building code or text from character codes reads as obfuscation`, file: rel, docsUrl: DOCS.moderation });
    }
  }

  // Optional permissions should be gated at runtime.
  for (const p of optionalOnly) {
    if (!usesPermissionCheck[p as keyof typeof usesPermissionCheck]) {
      findings.push({ level: "info", code: "optional-permission-ungated", message: `${p} is optional but Plugin.HasPermission(PluginPermissions.${p}) is never called; gate the feature so the plugin works when the user declines`, file: "plugin.json", docsUrl: DOCS.hasPermission });
    }
  }
  if (!manifest?.contactEmailAddress) {
    // validatePluginDir already reports the schema error; add the legal context once.
    if (!findings.some((f) => f.code === "manifest-schema" && f.message.includes("contactEmailAddress"))) {
      findings.push({ level: "error", code: "contact-email", message: "contactEmailAddress is required by Jagex for every submitted plugin", file: "plugin.json", docsUrl: DOCS.manifest });
    }
  } else if (isPlaceholderEmail(manifest.contactEmailAddress)) {
    findings.push({
      level: "warning",
      code: "placeholder-email",
      message: `contactEmailAddress "${manifest.contactEmailAddress}" is a placeholder; set a real address before packaging (package refuses placeholders)`,
      file: "plugin.json",
      docsUrl: DOCS.manifest,
    });
  }

  return { manifest, findings, files: luaFiles };
}
