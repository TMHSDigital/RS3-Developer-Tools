#!/usr/bin/env node
// rs3dev: command line for RuneScape 3 plugin development.

import { Command } from "commander";
import { createRequire } from "node:module";
import {
  runInit,
  runPackage,
  runPreflight,
  runSync,
  runValidate,
  runWatch,
  type OutputOptions,
} from "./commands.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command();
program
  .name("rs3dev")
  .description("Developer toolkit for official RuneScape 3 plugins (Lua 5.4, RuneScape Client API)")
  .version(pkg.version)
  .option("--json", "print machine-readable JSON instead of text")
  .showHelpAfterError();

const output = (): OutputOptions => ({ json: Boolean(program.opts().json) });

program
  .command("init <name>")
  .description("scaffold a new plugin folder named <name> in the current directory")
  .option("-p, --permissions <list>", "optional permissions to request, comma separated (httpAccess,chatAccess,trackingAccess)")
  .option("--required-permissions <list>", "permissions the plugin cannot work without, comma separated")
  .option("--prettyui", "add PrettyUI as a required dependency")
  .option("--email <address>", "contactEmailAddress for plugin.json")
  .option("--no-agent-files", "do not copy AGENTS.md, Cursor rules and Claude Code skills")
  .option("--stubs <dir>", "stubs folder to reference from .luarc.json")
  .option("--force", "add files to an existing non-empty folder (never overwrites)")
  .option("-C, --cwd <dir>", "parent directory for the new plugin", process.cwd())
  .action(async (name: string, opts) => {
    process.exitCode = await runInit(name, opts, output());
  });

program
  .command("validate [path]")
  .description("check plugin.json against the schema and the plugin folder structure")
  .action(async (target: string | undefined) => {
    process.exitCode = await runValidate(target ?? ".", output());
  });

program
  .command("preflight [path]")
  .description("static checks for sandbox, permission and readability problems; exits 1 on errors")
  .option("--max-line-length <n>", "line length that counts as minified", "200")
  .action(async (target: string | undefined, opts) => {
    process.exitCode = await runPreflight(target ?? ".", opts, output());
  });

program
  .command("sync [path]")
  .description("copy the plugin into the client's dev_plugins folder and print the reload command")
  .option("--root <dir>", "dev_plugins folder (overrides detection and RS3_DEV_PLUGINS_DIR)")
  .option("--no-prune", "keep files in the destination that the source no longer has")
  .action(async (target: string | undefined, opts) => {
    process.exitCode = await runSync(target ?? ".", opts, output());
  });

program
  .command("watch [path]")
  .description("sync on every save, debounced; press Ctrl+C to stop")
  .option("--root <dir>", "dev_plugins folder (overrides detection and RS3_DEV_PLUGINS_DIR)")
  .option("--debounce <ms>", "quiet period after the last change", "300")
  .action(async (target: string | undefined, opts) => {
    process.exitCode = await runWatch(target ?? ".", opts, output());
  });

program
  .command("package [path]")
  .description("build the zip for manual upload to mod.io")
  .option("-o, --out <file>", "output archive path")
  .option("--overwrite", "replace an existing archive")
  .action(async (target: string | undefined, opts) => {
    process.exitCode = await runPackage(target ?? ".", opts, output());
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
