// Tool annotations sent to MCP clients so they can decide when to prompt
// before a call. mcp-tools.json at the repository root records the same facts
// for the ecosystem catalogue; tests/mcp-tools.test.ts keeps the two in step.

export interface ToolAnnotationSet {
  /** The tool does not modify anything the user owns. */
  readOnlyHint: boolean;
  /** The tool may delete or overwrite data (only meaningful when not read-only). */
  destructiveHint: boolean;
  /** Repeating the call with the same arguments has no further effect. */
  idempotentHint: boolean;
  /** The tool reaches outside the local workspace (network). */
  openWorldHint: boolean;
}

export const TOOL_ANNOTATIONS: Record<string, ToolAnnotationSet> = {
  docs_search: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  docs_get: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  docs_index: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  api_lookup: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  manifest_validate: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  guidelines_preflight: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  plugin_scaffold: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  devplugins_sync: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  package_zip: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

export const PROMPT_NAMES = ["new_plugin", "fix_preflight", "prepare_submission"] as const;
