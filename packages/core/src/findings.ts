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
  events: "https://developer.runescape.com/rs/core/events.html",
  eventsLogic: "https://developer.runescape.com/rs/core/events.html#logic",
  componentDestroy: "https://developer.runescape.com/rs/ui/component.html#destroy",
  componentUnsubscribe: "https://developer.runescape.com/rs/ui/component.html#unsubscribe",
  /** rs3dev.json is this toolkit's own file; the schema is the reference. */
  config: "https://github.com/TMHSDigital/RS3-Developer-Tools/blob/main/packages/schema/rs3dev.schema.json",
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

/** Escape a value for a GitHub Actions workflow command property or message. */
function escapeWorkflowCommand(value: string, property: boolean): string {
  let out = value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  if (property) out = out.replace(/:/g, "%3A").replace(/,/g, "%2C");
  return out;
}

/**
 * Render findings as GitHub Actions workflow commands so they show up as
 * annotations on the files of a plugin repository. The file path is relative
 * to the plugin folder; pass pluginPrefix when the plugin is not at the
 * repository root.
 */
export function formatFindingsGithub(findings: Finding[], pluginPrefix = ""): string[] {
  return findings.map((f) => {
    const kind = f.level === "error" ? "error" : f.level === "warning" ? "warning" : "notice";
    const props: string[] = [];
    if (f.file) props.push(`file=${escapeWorkflowCommand(pluginPrefix ? `${pluginPrefix}/${f.file}` : f.file, true)}`);
    if (f.line) props.push(`line=${f.line}`);
    props.push(`title=${escapeWorkflowCommand(f.code, true)}`);
    return `::${kind} ${props.join(",")}::${escapeWorkflowCommand(`${f.message} (see ${f.docsUrl})`, false)}`;
  });
}

/** Minimal SARIF 2.1.0 log with one rule per finding code, for GitHub code scanning uploads. */
export function toSarif(findings: Finding[], tool: { name: string; version: string; command: string }, pluginPrefix = ""): Record<string, unknown> {
  const rules = new Map<string, { id: string; shortDescription: { text: string }; helpUri: string }>();
  for (const f of findings) {
    if (!rules.has(f.code)) rules.set(f.code, { id: f.code, shortDescription: { text: f.code }, helpUri: f.docsUrl });
  }
  const ruleIds = [...rules.keys()];
  const results = findings.map((f) => ({
    ruleId: f.code,
    ruleIndex: ruleIds.indexOf(f.code),
    level: f.level === "info" ? "note" : f.level,
    message: { text: f.message },
    ...(f.file
      ? {
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: (pluginPrefix ? `${pluginPrefix}/${f.file}` : f.file).replace(/\\/g, "/") },
                ...(f.line ? { region: { startLine: f.line } } : {}),
              },
            },
          ],
        }
      : {}),
  }));
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: tool.name,
            version: tool.version,
            informationUri: "https://github.com/TMHSDigital/RS3-Developer-Tools",
            rules: [...rules.values()],
          },
        },
        automationDetails: { id: `rs3dev/${tool.command}` },
        results,
      },
    ],
  };
}
