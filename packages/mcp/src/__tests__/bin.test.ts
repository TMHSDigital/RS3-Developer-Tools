import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// Guards the stdio entry point. npm installs the bin as a symlink on Linux and
// macOS, so the server must start regardless of what process.argv[1] looks like.
const binEntry = fileURLToPath(new URL("../../dist/bin.js", import.meta.url));

const tempDirs: string[] = [];
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await fsp.rm(dir, { recursive: true, force: true });
});

function waitForReady(entry: string, workspace: string): Promise<{ stderr: string; exited: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, "--workspace", workspace], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let settled = false;
    const finish = (value: { stderr: string; exited: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(value);
    };
    const timer = setTimeout(() => finish({ stderr, exited: false }), 15000);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (/ ready; workspace /.test(stderr)) finish({ stderr, exited: false });
    });
    child.on("exit", () => finish({ stderr, exited: true }));
    child.on("error", reject);
  });
}

describe("rs3-plugin-mcp bin", () => {
  it("starts and prints the ready line when run directly", async () => {
    const exists = await fsp.stat(binEntry).then(
      () => true,
      () => false,
    );
    if (!exists) return; // build has not run yet; server.test.ts covers the logic
    const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "rs3-mcp-bin-"));
    tempDirs.push(workspace);
    const result = await waitForReady(binEntry, workspace);
    expect(result.exited).toBe(false);
    expect(result.stderr).toMatch(/^rs3-plugin-mcp \S+ ready; workspace /m);
  });

  it("starts when launched through a symlink named like the npm bin", async () => {
    const exists = await fsp.stat(binEntry).then(
      () => true,
      () => false,
    );
    if (!exists) return;
    const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "rs3-mcp-bin-link-"));
    tempDirs.push(workspace);
    const link = path.join(workspace, "rs3-plugin-mcp");
    try {
      await fsp.symlink(binEntry, link, "file");
    } catch {
      return; // symlinks need elevated rights on some Windows setups; the direct run above still covers the entry
    }
    const result = await waitForReady(link, workspace);
    expect(result.exited).toBe(false);
    expect(result.stderr).toMatch(/ ready; workspace /);
  });
});
