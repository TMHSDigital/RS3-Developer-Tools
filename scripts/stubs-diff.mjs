// Semantic diff of two stubs index.json files, printed as Markdown.
//
//   node scripts/stubs-diff.mjs <old index.json> <new index.json> [--date YYYY-MM-DD]
//
// The weekly regeneration uses it to write api-changes.md and the commit
// body, so a reader learns "Event.X was added, Y:Z changed its return type"
// without opening an 11 MB Lua diff. Entries carry the docs URL; nothing from
// the documentation text itself is included.

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** @typedef {{ name: string; kind: string; signature: string; url: string; module: string }} Symbol */

/** Compare two indexes by name and kind. */
export function diffIndexes(oldIndex, newIndex) {
  const key = (s) => `${s.name}|${s.kind}`;
  const before = new Map((oldIndex.symbols ?? []).map((s) => [key(s), s]));
  const after = new Map((newIndex.symbols ?? []).map((s) => [key(s), s]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [k, s] of after) {
    const prev = before.get(k);
    if (!prev) added.push(s);
    else if (prev.signature !== s.signature) changed.push({ before: prev, after: s });
  }
  for (const [k, s] of before) if (!after.has(k)) removed.push(s);
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  added.sort(byName);
  removed.sort(byName);
  changed.sort((a, b) => byName(a.after, b.after));
  const oldModules = new Set((oldIndex.modules ?? []).map((m) => m.id));
  const newModules = new Set((newIndex.modules ?? []).map((m) => m.id));
  const pagesAdded = [...newModules].filter((m) => !oldModules.has(m)).sort();
  const pagesRemoved = [...oldModules].filter((m) => !newModules.has(m)).sort();
  return { added, removed, changed, pagesAdded, pagesRemoved };
}

function line(s) {
  return `- \`${s.name}\` (${s.kind}): \`${s.signature}\` ([docs](${s.url}))`;
}

/** Markdown for one digest; empty string when nothing changed. */
export function renderDigest(diff, options = {}) {
  const { added, removed, changed, pagesAdded, pagesRemoved } = diff;
  const total = added.length + removed.length + changed.length + pagesAdded.length + pagesRemoved.length;
  if (total === 0) return "";
  const out = [];
  const heading = options.date ? `## ${options.date}` : "## Changes";
  out.push(heading, "");
  out.push(
    `${added.length} added, ${removed.length} removed, ${changed.length} signature change(s)${pagesAdded.length || pagesRemoved.length ? `, pages: +${pagesAdded.length} -${pagesRemoved.length}` : ""}.`,
    "",
  );
  if (pagesAdded.length) out.push("### New pages", "", ...pagesAdded.map((p) => `- ${p}`), "");
  if (pagesRemoved.length) out.push("### Removed pages", "", ...pagesRemoved.map((p) => `- ${p}`), "");
  if (added.length) out.push("### Added", "", ...added.map(line), "");
  if (removed.length) out.push("### Removed", "", ...removed.map(line), "");
  if (changed.length) {
    out.push("### Signature changed", "");
    for (const c of changed) {
      out.push(`- \`${c.after.name}\` (${c.after.kind}) ([docs](${c.after.url}))`, `  - was: \`${c.before.signature}\``, `  - now: \`${c.after.signature}\``);
    }
    out.push("");
  }
  return out.join("\n");
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith("--"));
  const dateIndex = argv.indexOf("--date");
  const date = dateIndex >= 0 ? argv[dateIndex + 1] : undefined;
  if (args.length !== 2) {
    console.error("usage: node scripts/stubs-diff.mjs <old index.json> <new index.json> [--date YYYY-MM-DD]");
    process.exit(2);
  }
  const oldIndex = JSON.parse(readFileSync(args[0], "utf8"));
  const newIndex = JSON.parse(readFileSync(args[1], "utf8"));
  const digest = renderDigest(diffIndexes(oldIndex, newIndex), { date });
  if (!digest) {
    console.error("no API changes between the two indexes");
    process.exit(0);
  }
  process.stdout.write(digest + "\n");
}

// Run only when executed directly (realpath: npm bins are symlinks on Unix).
const invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invoked === realpathSync(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
