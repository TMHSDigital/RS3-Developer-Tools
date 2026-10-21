#!/usr/bin/env node
// stdio entry point for @tmhs/rs3-plugin-mcp.
//
//   rs3-plugin-mcp [--workspace <dir>]
//
// The workspace defaults to RS3_WORKSPACE or the current directory. Only
// plugins inside it (and the client's dev_plugins root) can be read or written.

import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, createServer } from "./server.js";

export { createServer, SERVER_NAME } from "./server.js";

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wsIndex = args.indexOf("--workspace");
  const workspaceRoot = wsIndex >= 0 ? args[wsIndex + 1] ?? process.cwd() : process.env.RS3_WORKSPACE ?? process.cwd();
  const version = readVersion();
  const server = await createServer({ workspaceRoot, version });
  await server.connect(new StdioServerTransport());
  // stdout is the MCP channel; log to stderr only.
  console.error(`${SERVER_NAME} ${version} ready; workspace ${workspaceRoot}`);
}

const invokedDirectly = process.argv[1] && /index\.js$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
}
