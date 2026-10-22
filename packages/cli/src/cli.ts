#!/usr/bin/env node

// rs3dev: command line for RuneScape 3 plugin development.

import { createRequire } from "node:module";
import * as path from "node:path";
import { Command } from "commander";
import {
  type OutputOptions,
  runAdopt,
  runCache,
  runDoctor,
  runInit,
  runLuarc,
  runPackage,
  runPreflight,
  runStubs,
  runSync,
  runValidate,
  runWatch,
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
  .option(
    "--url <name=https://host/>",
    "base URL to declare under urls in plugin.json (repeatable)",
    (value: string, previous: string[]) => [...previous, value],
    [] as string[],
  )
  .option("--no-agent-files", "do not copy AGENTS.md, Cursor rules and Claude Code skills")
  .option("--stubs <dir>", "stubs folder to reference from .luarc.json (default: RS3_STUBS_DIR or the installed @tmhs/rs3-luals-stubs)")
  .option("--force", "add files to an existing non-empty folder (never overwrites)")
  .option("--existing", "treat <name> as an existing plugin folder: write .luarc.json and the agent files only (same as rs3dev adopt)")
  .option("--vendor", "with --existing: copy the stubs into <plugin>/.rs3/stubs so .luarc.json is portable")
  .option("-C, --cwd <dir>", "parent directory for the new plugin", process.cwd())
  .action(async (name: string, opts) => {
    process.exitCode = opts.existing ? await runAdopt(path.resolve(opts.cwd ?? process.cwd(), name), opts, output()) : await runInit(name, opts, output());
  });

program
  .command("adopt [path]")
  .description(
    "bring an existing plugin folder into the toolkit: .luarc.json plus AGENTS.md, Cursor rules and Claude Code skills; plugin.json and main.lua are never touched",
  )
  .option("--stubs <dir>", "stubs folder to reference (default: RS3_STUBS_DIR or the installed @tmhs/rs3-luals-stubs)")
  .option("--vendor", "copy the stubs into <plugin>/.rs3/stubs and point .luarc.json at ./.rs3/stubs (portable, about 11 MB)")
  .option("--no-agent-files", "write .luarc.json only")
  .action(async (target: string | undefined, opts) => {
    process.exitCode = await runAdopt(target ?? ".", opts, output());
  });

program
  .command("luarc [path]")
  .description("write or refresh .luarc.json for a plugin folder and print which stubs location was used")
  .option("--stubs <dir>", "stubs folder to reference (default: RS3_STUBS_DIR or the installed @tmhs/rs3-luals-stubs)")
  .option("--vendor", "copy the stubs into <plugin>/.rs3/stubs and point .luarc.json at ./.rs3/stubs (portable, about 11 MB)")
  .action(async (target: string | undefined, opts) => {
    process.exitCode = await runLuarc(target ?? ".", opts, output());
  });

program
  .command("validate [path]")
  .description("check plugin.json against the schema and the plugin folder structure")
  .option("--strict", "exit 1 on warnings as well as errors (for CI)")
  .option("--format <kind>", "text, json, github (workflow annotations) or sarif", "text")
  .option("--ignore <codes>", "finding codes to drop, comma separated")
  .action(async (target: string | undefined, opts) => {
    process.exitCode = await runValidate(target ?? ".", opts, output());
  });

program
  .command("preflight [path]")
  .description("static checks for sandbox, permission, lifecycle and readability problems; exits 1 on errors")
  .option("--max-line-length <n>", "line length that counts as minified (default 200, or rs3dev.json preflight.maxLineLength)")
  .option("--strict", "exit 1 on warnings as well as errors (for CI)")
  .option("--format <kind>", "text, json, github (workflow annotations) or sarif", "text")
  .option("--ignore <codes>", "finding codes to drop, comma separated (adds to rs3dev.json preflight.ignore)")
  .option("--no-config", "do not read rs3dev.json in the plugin folder")
  .action(async (target: string | undefined, opts) => {
    process.exitCode = await runPreflight(target ?? ".", opts, output());
  });

program
  .command("sync [path]")
  .description("copy the plugin into the client's dev_plugins folder and print the reload command")
  .option("--root <dir>", "dev_plugins folder (overrides detection and RS3_DEV_PLUGINS_DIR); must exist and look like dev_plugins")
  .option("--create-root", "accept and create a --root or RS3_DEV_PLUGINS_DIR that does not exist or is not named dev_plugins")
  .option("--no-prune", "keep files in the destination that the source no longer has")
  .action(async (target: string | undefined, opts) => {
    process.exitCode = await runSync(target ?? ".", opts, output());
  });

program
  .command("watch [path]")
  .description("sync on every save, debounced; press Ctrl+C to stop")
  .option("--root <dir>", "dev_plugins folder (overrides detection and RS3_DEV_PLUGINS_DIR); must exist and look like dev_plugins")
  .option("--create-root", "accept and create a --root or RS3_DEV_PLUGINS_DIR that does not exist or is not named dev_plugins")
  .option("--no-prune", "keep files in the destination that the source no longer has")
  .option("--debounce <ms>", "quiet period after the last change", "300")
  .action(async (target: string | undefined, opts) => {
    process.exitCode = await runWatch(target ?? ".", opts, output());
  });

program
  .command("doctor [path]")
  .description("report the client folder, stubs, LuaLS binary, .luarc.json and docs cache; exits 1 when something is missing")
  .option("--stubs <dir>", "stubs folder to check instead of RS3_STUBS_DIR or the installed package")
  .action(async (target: string | undefined, opts) => {
    process.exitCode = await runDoctor(target, opts, output());
  });

program
  .command("stubs <action>")
  .description("'status' checks whether the installed stubs still match the documentation (one conditional request)")
  .option("--stubs <dir>", "stubs folder whose index.json to check instead of RS3_STUBS_DIR or the installed package")
  .action(async (action: string, opts) => {
    process.exitCode = await runStubs(action, opts, output());
  });

program
  .command("cache <action>")
  .description("manage the documentation cache: 'path' prints its location, 'clear' removes it")
  .action(async (action: string) => {
    process.exitCode = await runCache(action, output());
  });

program
  .command("package [path]")
  .description("build the zip for manual upload to mod.io")
  .option("-o, --out <file>", "output archive path (default: dist/<plugin>-<version>.zip under the current directory)")
  .option("--overwrite", "replace an existing archive")
  .option("--allow-placeholder-email", "package even if contactEmailAddress is a placeholder (tests only)", false)
  .option("--list", "print every archive entry with its size")
  .option("--max-size <mb>", "warn when the plugin content exceeds this many megabytes", "10")
  .option("--verify <zip>", "do not build; inspect an existing archive (root layout, manifest, dev artefacts, require targets)")
  .action(async (target: string | undefined, opts) => {
    process.exitCode = await runPackage(target ?? ".", opts, output());
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
