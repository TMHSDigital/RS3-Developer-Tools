#!/usr/bin/env node
// rs3-stubs: regenerate the LuaLS stubs from the documentation.
//
//   rs3-stubs --out packages/luals-stubs            crawl the live site
//   rs3-stubs --out <dir> --offline <mirror dir>    read a local mirror (tests)
//   rs3-stubs --out <dir> --check                   exit 1 if output would change
//
// A crawl that visits fewer than --min-pages pages, or that shrinks the module
// or symbol count by more than ten percent compared to the index.json already
// in <dir>, exits 2 without writing anything (see guard.ts). --allow-shrink
// overrides that after a human has looked at the diff.

import * as path from "node:path";
import { DocsClient } from "@tmhs/rs3-devtools-core";
import { generate } from "./generate.js";
import { diffOutput, writeOutput } from "./cli-io.js";
import { checkCrawlGuard, readBaseline } from "./guard.js";

interface Args {
  out: string;
  offline?: string;
  baseUrl?: string;
  check: boolean;
  cacheOnly: boolean;
  quiet: boolean;
  minPages?: number;
  allowShrink: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { out: "", check: false, cacheOnly: false, quiet: false, allowShrink: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    if (a === "--out") args.out = next();
    else if (a === "--offline") args.offline = next();
    else if (a === "--base-url") args.baseUrl = next();
    else if (a === "--check") args.check = true;
    else if (a === "--cache-only") args.cacheOnly = true;
    else if (a === "--quiet") args.quiet = true;
    else if (a === "--min-pages") args.minPages = Number(next());
    else if (a === "--allow-shrink") args.allowShrink = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: rs3-stubs --out <dir> [--offline <mirror dir>] [--base-url <url>] [--check] [--cache-only] [--quiet] [--min-pages <n>] [--allow-shrink]",
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.out) throw new Error("--out <dir> is required");
  if (args.minPages !== undefined && !(Number.isInteger(args.minPages) && args.minPages >= 0)) throw new Error("--min-pages expects a non-negative integer");
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const log = args.quiet ? () => undefined : (m: string) => console.error(m);
  const client = new DocsClient({
    offlineDir: args.offline,
    baseUrl: args.baseUrl,
    cacheOnly: args.cacheOnly,
  });
  const result = await generate({ client, log });
  const outDir = path.resolve(args.out);
  const summary = `${result.modules.length} modules, ${result.index.length} symbols, ${result.notes.length} notes`;
  const baseline = await readBaseline(outDir);
  const problems = checkCrawlGuard(
    { pageCount: result.pageCount, modules: result.modules.length, symbols: result.index.length, notes: result.notes.length },
    baseline,
    { minPages: args.minPages, allowShrink: args.allowShrink },
  );
  if (problems.length > 0) {
    console.error(`refusing to write ${outDir}: this crawl looks broken (${summary}; crawled ${result.pageCount} pages)`);
    for (const p of problems) console.error("  " + p);
    console.error("Inspect the site and the parser; pass --allow-shrink to write the result anyway.");
    return 2;
  }
  if (args.check) {
    const differing = await diffOutput(outDir, result.files);
    if (differing.length > 0) {
      console.error(`stubs are out of date (${differing.length} files differ):`);
      for (const d of differing) console.error("  " + d);
      return 1;
    }
    log(`stubs are up to date (${summary})`);
    return 0;
  }
  const { written, removed } = await writeOutput(outDir, result.files);
  log(`wrote ${written} files to ${outDir} (${removed} stale removed); ${summary}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
