// A finding is one message from validate or preflight. Every finding links to
// the documentation page that explains the rule, so a developer can read the
// authoritative text rather than a paraphrase.

export type FindingLevel = "error" | "warning" | "info";

export interface Finding {
  level: FindingLevel;
  /** Stable machine-readable code, for example "sandbox-global". */
  code: string;
  message: string;
  /** File the finding refers to, relative to the plugin folder, when applicable. */
  file?: string;
  line?: number;
  /** Documentation page (and anchor) that explains the rule. */
  docsUrl: string;
}

export const DOCS = {
  structure: "https://developer.runescape.com/rs/structure.html",
  manifest: "https://developer.runescape.com/rs/structure.html#manifest",
  dependencies: "https://developer.runescape.com/rs/structure.html#dependencies",
  permissions: "https://developer.runescape.com/rs/core/plugin.html#pluginpermissions",
  hasPermission: "https://developer.runescape.com/rs/core/plugin.html#haspermission",
  http: "https://developer.runescape.com/rs/core/http.html#requirements",
  chat: "https://developer.runescape.com/rs/game/chat.html#requirements",
  chatEvent: "https://developer.runescape.com/rs/core/events.html#chatmessage",
  tracking: "https://developer.runescape.com/rs/game/player.html",
  guidelines: "https://developer.runescape.com/rs/submission/guidelines.html",
  moderation: "https://developer.runescape.com/rs/submission/guidelines.html#moderation",
  aiPolicy: "https://developer.runescape.com/rs/submission/guidelines.html#ai-policy",
  submission: "https://developer.runescape.com/rs/submission/process.html",
  tutorialFiles: "https://developer.runescape.com/rs/tutorial/1helloworld.html#plugin-files",
  managing: "https://developer.runescape.com/rs/managing.html",
  core: "https://developer.runescape.com/rs/core/index.html",
} as const;

export interface FindingSummary {
  errors: number;
  warnings: number;
  infos: number;
}

export function summarise(findings: Finding[]): FindingSummary {
  return {
    errors: findings.filter((f) => f.level === "error").length,
    warnings: findings.filter((f) => f.level === "warning").length,
    infos: findings.filter((f) => f.level === "info").length,
  };
}

/** Render findings as plain text lines for the terminal. */
export function formatFindings(findings: Finding[]): string[] {
  const lines: string[] = [];
  for (const f of findings) {
    const where = f.file ? ` ${f.file}${f.line ? ":" + f.line : ""}` : "";
    lines.push(`${f.level.toUpperCase()}${where} [${f.code}] ${f.message}`);
    lines.push(`  see ${f.docsUrl}`);
  }
  return lines;
}
