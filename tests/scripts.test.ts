import { spawnSync } from "node:child_process";
import { promises as fsp } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isBlocking, parseDiagnostics } from "../scripts/luals-check.mjs";
import { repoRoot } from "./helpers.js";

// The two scripts that had no unit coverage: the LuaLS check's parsing
// (including the diagnostic glued to the progress line) and the workspace
// linker's copy path, which is the documented install route on exFAT.

const tempDirs: string[] = [];
async function tempDir(prefix: string): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await fsp.rm(dir, { recursive: true, force: true });
});

describe("scripts/luals-check.mjs parsing", () => {
  it("keeps the diagnostic that follows the progress bar on the same line and dedupes repeats", () => {
    const esc = String.fromCharCode(27);
    const output = [
      "Initializing ...        \r>>>>>>>>>>>>>>>>>>>> 1/1 \r",
      `${esc}[34mC:\\work\\plugin\\main.lua:17:7${esc}[0m [${esc}[31mError${esc}[0m] Undefined global \`PrettyUI\`. ${esc}[35m(undefined-global)${esc}[0m\n`,
      "C:\\work\\plugin\\main.lua:17:7 [Error] Undefined global `PrettyUI`. (undefined-global)\n",
      "C:\\work\\plugin\\main.lua:41:24 [Hint] Unused local `event`. (unused-local)\n",
      "C:\\work\\plugin\\main.lua:50:5 [Warning] Cannot assign `string` to parameter `integer`.\n",
      "Diagnosis complete, 3 problems found\n",
    ].join("");
    const problems = parseDiagnostics(output);
    expect(problems.map((p) => [p.line, p.code, p.severity])).toEqual([
      [17, "undefined-global", "Error"],
      [41, "unused-local", "Hint"],
      [50, "param-type-mismatch", "Warning"],
    ]);
    expect(problems.map(isBlocking)).toEqual([true, false, true]);
  });

  it("returns nothing for a clean run", () => {
    expect(parseDiagnostics("Initializing ...\rDiagnosis complete, 0 problems found\n")).toEqual([]);
  });
});

describe("scripts/link-workspaces.mjs --copy", () => {
  it("copies each workspace package's publishable files into node_modules of the given root", async () => {
    const root = await tempDir("rs3-link-");
    await fsp.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fake-root", private: true, workspaces: ["packages/alpha", "packages/beta"] }));
    for (const name of ["alpha", "beta"]) {
      const dir = path.join(root, "packages", name);
      await fsp.mkdir(path.join(dir, "dist"), { recursive: true });
      await fsp.mkdir(path.join(dir, "src"), { recursive: true });
      await fsp.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: `@fake/${name}`, version: "0.0.1", files: ["dist", "README.md"] }));
      await fsp.writeFile(path.join(dir, "dist", "index.js"), `export const ${name} = true;\n`);
      await fsp.writeFile(path.join(dir, "src", "index.ts"), "// not published\n");
      await fsp.writeFile(path.join(dir, "README.md"), `# ${name}\n`);
    }
    const script = path.join(repoRoot, "scripts", "link-workspaces.mjs");
    const result = spawnSync(process.execPath, [script, "--copy", "--root", root], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("2 copied");
    for (const name of ["alpha", "beta"]) {
      const target = path.join(root, "node_modules", "@fake", name);
      expect(await fsp.readFile(path.join(target, "dist", "index.js"), "utf8")).toContain(name);
      expect(await fsp.readFile(path.join(target, "README.md"), "utf8")).toContain(name);
      await expect(fsp.stat(path.join(target, "src"))).rejects.toThrow();
      expect((await fsp.lstat(target)).isSymbolicLink()).toBe(false);
    }
    // --only restricts to one package and the copy is idempotent.
    const again = spawnSync(process.execPath, [script, "--copy", "--root", root, "--only", "packages/alpha"], { encoding: "utf8" });
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("1 copied");
  });
});
