// Build every workspace package in dependency order and refresh the
// node_modules/@tmhs copies when the packages are copied rather than linked
// (see link-workspaces.mjs). Runs tsc directly so no shell is involved.
//
// Before building, the Cursor rules, Claude Code skills and AGENTS.md from
// cursor-plugin/ are copied into packages/core/templates/agent-files so that
// "rs3dev init" can ship them when the package is installed from npm. The copy
// is gitignored; cursor-plugin/ stays the single source of truth.
//
// Usage: node scripts/build-all.mjs [--typecheck]

import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const tsc = require.resolve("typescript/bin/tsc");
const typecheckOnly = process.argv.includes("--typecheck");

async function copyAgentFiles() {
  const from = path.join(root, "cursor-plugin");
  const to = path.join(root, "packages", "core", "templates", "agent-files");
  await fsp.rm(to, { recursive: true, force: true });
  const exists = await fsp.stat(from).then(() => true, () => false);
  if (!exists) return;
  await fsp.mkdir(to, { recursive: true });
  // Rules go where Cursor reads them, skills where Claude Code reads them, and
  // AGENTS.md at the plugin root.
  const copies = [
    ["AGENTS.md", "AGENTS.md"],
    ["rules", path.join(".cursor", "rules")],
    ["skills", path.join(".claude", "skills")],
  ];
  for (const [src, dest] of copies) {
    const source = path.join(from, src);
    const ok = await fsp.stat(source).then(() => true, () => false);
    if (!ok) continue;
    await fsp.cp(source, path.join(to, dest), { recursive: true });
  }
}

await copyAgentFiles();

const rootPkg = JSON.parse(await fsp.readFile(path.join(root, "package.json"), "utf8"));
for (const workspace of rootPkg.workspaces) {
  const pkgDir = path.resolve(root, workspace);
  const tsconfig = path.join(pkgDir, "tsconfig.json");
  const hasTs = await fsp.stat(tsconfig).then(() => true, () => false);
  if (hasTs) {
    const extra = typecheckOnly ? ["--noEmit"] : [];
    const result = spawnSync(process.execPath, [tsc, "-p", tsconfig, ...extra], { stdio: "inherit" });
    if (result.status !== 0) {
      console.error(`build failed in ${workspace}`);
      process.exit(result.status ?? 1);
    }
  }
  if (!typecheckOnly) {
    const link = spawnSync(
      process.execPath,
      [path.join(root, "scripts", "link-workspaces.mjs"), "--only", pkgDir],
      { stdio: "inherit" },
    );
    if (link.status !== 0) process.exit(link.status ?? 1);
  }
  console.log(`${typecheckOnly ? "typechecked" : "built"} ${workspace}`);
}
