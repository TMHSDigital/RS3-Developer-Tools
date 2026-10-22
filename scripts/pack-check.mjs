// Check what each workspace package would publish, before anything is
// published. npm pack --dry-run lists the tarball contents; the expectations
// below are the files the documented install paths rely on.
//
//   node scripts/pack-check.mjs [--root <monorepo dir>]

import { execFileSync, execSync } from "node:child_process";
import { promises as fsp, realpathSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Required tarball entries per package (prefix match for folders). */
export const EXPECTED = {
  "@tmhs/rs3-plugin-schema": ["package.json", "README.md", "plugin.schema.json", "rs3dev.schema.json", "settings.sample.json", "dist/index.js"],
  "@tmhs/rs3-devtools-core": [
    "package.json",
    "README.md",
    "dist/index.js",
    "templates/agent-files/AGENTS.md",
    "templates/agent-files/.cursor/rules/",
    "templates/agent-files/.claude/skills/",
  ],
  "@tmhs/rs3-stubs-generator": ["package.json", "README.md", "dist/cli.js", "overrides.json"],
  "@tmhs/rs3-luals-stubs": ["package.json", "README.md", "index.json", "unresolved.md", "luarc.template.json", "stubs/_globals.lua", "stubs/_extras.lua"],
  "@tmhs/rs3-devtools-cli": ["package.json", "README.md", "dist/cli.js"],
  "@tmhs/rs3-plugin-mcp": ["package.json", "README.md", "dist/bin.js", "dist/index.js", "examples/claude-code.mcp.json"],
};

/** Problems found across every workspace, empty when all tarballs are complete. */
export async function checkPacks(root) {
  const rootPkg = JSON.parse(await fsp.readFile(path.join(root, "package.json"), "utf8"));
  const problems = [];
  const summary = [];
  for (const workspace of rootPkg.workspaces) {
    const dir = path.join(root, workspace);
    // npm is a .cmd shim on Windows, which needs a shell; pass one fixed command
    // string there so Node does not warn about unescaped arguments (DEP0190).
    const out =
      process.platform === "win32"
        ? execSync("npm.cmd pack --dry-run --json", { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: true })
        : execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const info = JSON.parse(out)[0];
    const files = new Set(info.files.map((f) => f.path.replace(/\\/g, "/")));
    const expected = EXPECTED[info.name] ?? [];
    for (const want of expected) {
      const ok = want.endsWith("/") ? [...files].some((f) => f.startsWith(want)) : files.has(want);
      if (!ok) problems.push(`${info.name}: tarball lacks ${want}`);
    }
    for (const f of files) {
      if (/(^|\/)__tests__\//.test(f) || /\.test\.ts$/.test(f) || /(^|\/)src\//.test(f)) problems.push(`${info.name}: tarball ships ${f}`);
    }
    if (!info.name.startsWith("@tmhs/")) problems.push(`${workspace}: unexpected package name ${info.name}`);
    summary.push(`${info.name}@${info.version}: ${files.size} files, ${(info.unpackedSize / 1024).toFixed(0)} KB`);
  }
  return { problems, summary };
}

async function main(argv) {
  const rootIndex = argv.indexOf("--root");
  const root = rootIndex >= 0 ? path.resolve(argv[rootIndex + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { problems, summary } = await checkPacks(root);
  for (const line of summary) console.log(line);
  if (problems.length > 0) {
    for (const p of problems) console.error(`::error title=pack check::${p}`);
    return 1;
  }
  console.log("every workspace tarball carries the files the install paths need");
  return 0;
}

const invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invoked === realpathSync(fileURLToPath(import.meta.url))) process.exit(await main(process.argv.slice(2)));
