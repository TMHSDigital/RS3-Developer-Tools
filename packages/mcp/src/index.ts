// Library entry point for @tmhs/rs3-plugin-mcp.
//
// The stdio executable lives in bin.ts; this module only re-exports the server
// factory so tests and embedders can build a server over any transport.

export { createServer, SERVER_NAME } from "./server.js";
