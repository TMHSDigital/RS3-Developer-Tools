# @tmhs/rs3-devtools-cli

The `rs3dev` command for RuneScape 3 plugin development.

```powershell
rs3dev init <name> [--permissions httpAccess,chatAccess] [--required-permissions ...] [--prettyui] [--email <address>] [--no-agent-files] [--force]
rs3dev validate [path]
rs3dev preflight [path] [--max-line-length 200]
rs3dev sync [path] [--root <dev_plugins>] [--create-root] [--no-prune]
rs3dev watch [path] [--root <dev_plugins>] [--create-root] [--debounce 300]
rs3dev package [path] [--out file.zip] [--overwrite]
rs3dev --json <command>
```

| Command | Exit code |
| --- | --- |
| `validate`, `preflight` | 1 when any error-level finding exists |
| `sync`, `watch`, `package`, `init` | 1 on failure |

`sync` copies (never junctions) into `<RuneScape-BETA>/dev_plugins/<folder>` and prints the console command `prl <folder>`. The root is taken from `--root`, then `RS3_DEV_PLUGINS_DIR`, then detected by finding a client folder containing `*.jcache` files. An explicit root must already exist and either be named `dev_plugins` or sit beside the client's `*.jcache` files; a typo fails with the resolved path instead of silently creating a folder elsewhere. Pass `--create-root` to accept and create an unusual layout. Because `sync` prunes files the source lacks, it also refuses a non-empty destination that holds no `plugin.json`. Files locked by the running client are retried with backoff; if they stay locked, disable the plugin with `poff <name>` and sync again.

`package` runs preflight first and refuses to build when it reports errors. The archive has `plugin.json` and `main.lua` at its root and excludes dotfiles, `AGENTS.md`, `CLAUDE.md`, `node_modules`, `dist`, `tests` and other zips.
