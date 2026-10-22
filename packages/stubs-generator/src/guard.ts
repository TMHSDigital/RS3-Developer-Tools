// Crawl guard: refuse to write (and, in CI, to commit) a regeneration that
// looks like a broken crawl rather than a documentation change.
//
// The generator trusts the site's navigation markup. If that markup changes,
// extractNavLinks returns a short or empty list and the output shrinks to a
// handful of modules. Comparing against the committed index.json and
// unresolved.md turns that into a loud failure instead of a silent commit.

import { promises as fsp } from "node:fs";
import * as path from "node:path";

export interface CrawlBaseline {
  modules: number;
  symbols: number;
  notes: number;
}

export interface CrawlSummary {
  /** Pages the crawl visited, API and tutorial pages alike. */
  pageCount: number;
  modules: number;
  symbols: number;
  notes: number;
}

export interface GuardOptions {
  /** Fewer visited pages than this is treated as a broken crawl. Default 50. */
  minPages?: number;
  /** Allowed drop in modules or symbols as a fraction of the baseline. Default 0.1. */
  maxShrink?: number;
  /** Allowed growth of unresolved notes as a fraction of the baseline, once past minNoteGrowth. Default 0.5. */
  maxNoteGrowth?: number;
  /** Absolute note growth below which the ratio is not checked (small baselines). Default 20. */
  minNoteGrowth?: number;
  /** Skip every check; the operator has looked at the diff. */
  allowShrink?: boolean;
}

/** Read the counts of a previously written output folder, or undefined when there is none. */
export async function readBaseline(outDir: string): Promise<CrawlBaseline | undefined> {
  let index: { modules?: unknown[]; symbols?: unknown[] };
  try {
    index = JSON.parse(await fsp.readFile(path.join(outDir, "index.json"), "utf8")) as typeof index;
  } catch {
    return undefined;
  }
  let notes = 0;
  try {
    const unresolved = await fsp.readFile(path.join(outDir, "unresolved.md"), "utf8");
    notes = unresolved.split(/\r?\n/).filter((line) => line.startsWith("- ")).length;
  } catch {
    // No report yet; growth is not checked.
  }
  return { modules: index.modules?.length ?? 0, symbols: index.symbols?.length ?? 0, notes };
}

/** Problems that make this crawl unsafe to write. Empty when the result may be written. */
export function checkCrawlGuard(summary: CrawlSummary, baseline: CrawlBaseline | undefined, options: GuardOptions = {}): string[] {
  if (options.allowShrink) return [];
  const minPages = options.minPages ?? 50;
  const maxShrink = options.maxShrink ?? 0.1;
  const maxNoteGrowth = options.maxNoteGrowth ?? 0.5;
  const minNoteGrowth = options.minNoteGrowth ?? 20;
  const problems: string[] = [];
  if (summary.pageCount < minPages) {
    problems.push(`the crawl visited ${summary.pageCount} page(s) but at least ${minPages} are expected; the site navigation markup may have changed`);
  }
  if (baseline) {
    const shrink = (label: string, now: number, before: number) => {
      if (before === 0) return;
      const drop = (before - now) / before;
      if (drop > maxShrink) {
        problems.push(`${label} dropped from ${before} to ${now} (${Math.round(drop * 100)}%), more than the ${Math.round(maxShrink * 100)}% allowed`);
      }
    };
    shrink("modules", summary.modules, baseline.modules);
    shrink("symbols", summary.symbols, baseline.symbols);
    const growth = summary.notes - baseline.notes;
    if (baseline.notes > 0 && growth > minNoteGrowth && growth / baseline.notes > maxNoteGrowth) {
      problems.push(`unresolved notes grew from ${baseline.notes} to ${summary.notes}; the parser is no longer understanding pages it used to`);
    }
  }
  return problems;
}
