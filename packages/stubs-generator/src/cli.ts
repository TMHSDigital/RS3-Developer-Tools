#!/usr/bin/env node
// rs3-stubs: regenerate the LuaLS stubs from the documentation.
//
//   rs3-stubs --out packages/luals-stubs            crawl the live site
//   rs3-stubs --out <dir> --offline <mirror dir>    read a local mirror (tests)
//   rs3-stubs --out <dir> --check                   exit 1 if output would change

import * as path from "node:path";
import { DocsClient } from "@tmhs/rs3-devtools-core";
import { generate } from "./generate.js";
import { diffOutput, writeOutput } from "./cli-io.js";

interface Args {
  out: string;
  offline?: string;
  baseUrl?: string;
  check: boolean;
  cacheOnly: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { out: "", check: false, cacheOnly: false, quiet: false };
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
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: rs3-stubs --out <dir> [--offline <mirror dir>] [--base-url <url>] [--check] [--cache-only] [--quiet]",
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.out) throw new Error("--out <dir> is required");
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
