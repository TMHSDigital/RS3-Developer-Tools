// Full-text index over the documentation pages a user has fetched. It lives
// only in the per-user cache (cacheDir()/docs-index), is built on request from
// pages the DocsClient fetches through its ETag cache, and is never written to
// a repository: the docs are copyright Jagex, and the policy allows indexing
// developer.runescape.com for the developer's own use.
//
// The index is small and plain: every section of every page becomes one
// document (page, heading, anchor, a short excerpt), and an inverted map from
// lowercase terms to document ids drives the search.

import * as path from "node:path";
import type { DocsClient, DocsPage } from "./docs-client.js";
import { docsPageToText, extractNavLinks } from "./docs-text.js";
import { pathExists, readUtf8, writeUtf8NoBom } from "./fs.js";
import { cacheDir } from "./paths.js";

export interface DocsIndexDocument {
  page: string;
  title: string;
  heading: string;
  anchor: string;
  url: string;
  /** First sentence or so of the section, for the result list. */
  excerpt: string;
}

export interface DocsIndex {
  version: 1;
  baseUrl: string;
  /** ISO date of the build; informational, the index is never committed. */
  builtAt: string;
  pages: number;
  documents: DocsIndexDocument[];
  /** term -> document ids (indices into documents). */
  terms: Record<string, number[]>;
}

export interface DocsIndexHit extends DocsIndexDocument {
  score: number;
}

const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "is",
  "it",
  "for",
  "on",
  "with",
  "this",
  "that",
  "be",
  "as",
  "by",
  "are",
  "at",
  "from",
  "can",
  "will",
  "not",
  "if",
]);

/** Lowercase word tokens; dotted API names are kept whole and also split. */
export function tokenise(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9_.:]+/)) {
    if (!raw) continue;
    const word = raw.replace(/^[.:]+|[.:]+$/g, "");
    if (!word || STOP.has(word)) continue;
    out.add(word);
    for (const part of word.split(/[.:]/)) if (part.length > 1 && !STOP.has(part)) out.add(part);
  }
  return [...out];
}

/** Where the index is stored for this user. */
export function docsIndexPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(cacheDir(env), "docs-index", "index.json");
}

export interface BuildDocsIndexOptions {
  /** Pages to index (relative paths); defaults to the navigation of index.html. */
  pages?: string[];
  /** Where to write; defaults to docsIndexPath(). Pass null to skip writing. */
  outFile?: string | null;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}

/** Fetch every page through the client, convert it, and build the index. */
export async function buildDocsIndex(client: DocsClient, options: BuildDocsIndexOptions = {}): Promise<{ index: DocsIndex; file?: string }> {
  const log = options.log ?? (() => undefined);
  const indexPage = await client.getPage("index.html");
  const pages = (options.pages ?? extractNavLinks(indexPage.html)).slice().sort();
  const documents: DocsIndexDocument[] = [];
  const terms = new Map<string, Set<number>>();
  const add = (term: string, id: number) => {
    const set = terms.get(term) ?? new Set<number>();
    set.add(id);
    terms.set(term, set);
  };
  for (const rel of pages) {
    let page: DocsPage;
    try {
      page = await client.getPage(rel);
    } catch (error) {
      log(`skipping ${rel}: ${(error as Error).message}`);
      continue;
    }
    const text = docsPageToText(page.html);
    const lines = text.text.split("\n");
    const sections = text.sections.length > 0 ? text.sections : [{ heading: text.title, level: 1, anchor: "", line: 0 }];
    sections.forEach((section, i) => {
      const next = sections[i + 1];
      const body = lines
        .slice(section.line + 1, next ? next.line : undefined)
        .filter((l) => l.trim() && !l.startsWith("#"))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const id = documents.length;
      documents.push({
        page: rel.replace(/\.html$/, ""),
        title: text.title,
        heading: section.heading,
        anchor: section.anchor,
        url: `${page.url}${section.anchor ? "#" + section.anchor : ""}`,
        excerpt: body.slice(0, 160),
      });
      for (const term of tokenise(`${text.title} ${section.heading} ${body}`)) add(term, id);
      // Heading and title terms count extra by being indexed under a boosted key.
      for (const term of tokenise(`${text.title} ${section.heading}`)) add(`^${term}`, id);
    });
    log(`indexed ${rel} (${sections.length} sections)`);
  }
  const index: DocsIndex = {
    version: 1,
    baseUrl: client.baseUrl,
    builtAt: new Date().toISOString(),
    pages: pages.length,
    documents,
    terms: Object.fromEntries([...terms.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([t, ids]) => [t, [...ids].sort((a, b) => a - b)])),
  };
  const outFile = options.outFile === null ? undefined : (options.outFile ?? docsIndexPath(options.env));
  if (outFile) await writeUtf8NoBom(outFile, JSON.stringify(index));
  return { index, file: outFile };
}

/** Load a previously built index, or undefined when none exists. */
export async function loadDocsIndex(file: string = docsIndexPath()): Promise<DocsIndex | undefined> {
  if (!(await pathExists(file))) return undefined;
  try {
    const parsed = JSON.parse(await readUtf8(file)) as DocsIndex;
    return parsed.version === 1 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Rank sections for a query: every term must match (falls back to any term), heading hits count double. */
export function searchDocsIndex(index: DocsIndex, query: string, limit = 10): DocsIndexHit[] {
  const terms = tokenise(query);
  if (terms.length === 0) return [];
  const scores = new Map<number, number>();
  const matchedTerms = new Map<number, number>();
  for (const term of terms) {
    const ids = index.terms[term] ?? [];
    const boosted = new Set(index.terms[`^${term}`] ?? []);
    for (const id of ids) {
      scores.set(id, (scores.get(id) ?? 0) + (boosted.has(id) ? 3 : 1));
      matchedTerms.set(id, (matchedTerms.get(id) ?? 0) + 1);
    }
  }
  const all = [...scores.entries()];
  const strict = all.filter(([id]) => matchedTerms.get(id) === terms.length);
  const chosen = strict.length > 0 ? strict : all;
  return chosen
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([id, score]) => ({ ...index.documents[id]!, score }));
}
