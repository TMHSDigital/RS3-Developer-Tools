// Make every workspace package resolvable as node_modules/@tmhs/<name>.
//
// npm links workspaces with symlinks (junctions on Windows). Some volumes,
// exFAT for example, cannot hold reparse points and npm install fails there.
// This script tries a junction first and falls back to copying the package's
// publishable files, so "npm install --workspaces=false && npm run link" works
// on any filesystem. On platforms where npm already linked the packages the
// script leaves the existing symlinks alone.
//
// Usage: node scripts/link-workspaces.mjs [--copy] [--only <package dir>] [--root <monorepo dir>]

import * as fs from "node:fs";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
// --root <dir> points at another monorepo (tests); default is this repository.
const rootIndex = args.indexOf("--root");
const root = rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forceCopy = args.includes("--copy");
const onlyIndex = args.indexOf("--only");
const only = onlyIndex >= 0 ? path.resolve(root, args[onlyIndex + 1]) : undefined;

const rootPkg = JSON.parse(await fsp.readFile(path.join(root, "package.json"), "utf8"));
const workspaces = rootPkg.workspaces.map((w) => path.resolve(root, w));

async function copyEntry(src, dest) {
  const stat = await fsp.stat(src).catch(() => undefined);
  if (!stat) return;
  if (stat.isDirectory()) {
    await fsp.mkdir(dest, { recursive: true });
    for (const entry of await fsp.readdir(src)) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      await copyEntry(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest);
  }
}

async function copyPackage(pkgDir, target, pkg) {
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.mkdir(target, { recursive: true });
  const entries = new Set(["package.json", ...(pkg.files ?? [])]);
  for (const entry of entries) {
    await copyEntry(path.join(pkgDir, entry), path.join(target, entry));
  }
}

let copied = 0;
let linked = 0;
let kept = 0;
for (const pkgDir of workspaces) {
  if (only && path.resolve(only) !== pkgDir) continue;
  const pkg = JSON.parse(await fsp.readFile(path.join(pkgDir, "package.json"), "utf8"));
  const target = path.join(root, "node_modules", ...pkg.name.split("/"));
  const existing = await fsp.lstat(target).catch(() => undefined);
  if (existing?.isSymbolicLink() && !forceCopy) {
    kept++;
    continue;
  }
  if (!forceCopy) {
    try {
      await fsp.rm(target, { recursive: true, force: true });
      await fsp.mkdir(path.dirname(target), { recursive: true });
      fs.symlinkSync(pkgDir, target, "junction");
      linked++;
      continue;
    } catch (error) {
      if (!["EISDIR", "EPERM", "ENOSYS", "EINVAL"].includes(error.code)) throw error;
    }
  }
  await copyPackage(pkgDir, target, pkg);
  copied++;
}
console.log(`workspaces: ${linked} linked, ${copied} copied, ${kept} already linked`);
