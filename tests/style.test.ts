// Enforces the writing-style constraints of this repository: no emoji, no em or
// en dashes, no smart quotes, and UTF-8 without BOM in every text file.
//
// The forbidden characters are built from code points so this file itself does
// not contain them.

import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { listFiles, repoRoot } from "./helpers.js";

const TEXT_EXTENSIONS = [".md", ".mdc", ".ts", ".mjs", ".js", ".lua", ".json", ".yml", ".yaml", ".cursorrules", ".editorconfig"];
const cp = (...codes: number[]) => codes.map((c) => String.fromCodePoint(c)).join("");
const EM_OR_EN_DASH = new RegExp(`[${cp(0x2013, 0x2014)}]`);
const SMART_QUOTES = new RegExp(`[${cp(0x2018, 0x2019, 0x201c, 0x201d)}]`);
// Emoji and pictograph blocks; the generated stubs and fixtures are plain ASCII too.
const EMOJI = new RegExp(`[${cp(0x1f300)}-${cp(0x1faff)}${cp(0x1f000)}-${cp(0x1f2ff)}${cp(0x2600)}-${cp(0x27bf)}${cp(0xfe0f)}]`, "u");

describe("writing style", async () => {
  const files = await listFiles(repoRoot, (rel) => {
    if (rel.startsWith("packages/luals-stubs/stubs/")) return rel.endsWith(".lua") && rel.includes("_globals");
    if (rel.includes("/fixtures/")) return false;
    if (rel === "package-lock.json") return false;
    return TEXT_EXTENSIONS.some((ext) => rel.endsWith(ext)) || rel.endsWith(".cursorrules");
  });

  it("scans a meaningful set of files", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  for (const rel of files) {
    it(`${rel} has no emoji, dashes, smart quotes or BOM`, async () => {
      const buffer = await fsp.readFile(path.join(repoRoot, rel));
      expect(buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf, "UTF-8 BOM").toBe(false);
      const text = buffer.toString("utf8");
      const dash = text.match(EM_OR_EN_DASH);
      const context = dash ? text.slice(Math.max(0, dash.index! - 30), dash.index! + 30) : "";
      expect(dash, `em/en dash near: ${context}`).toBeNull();
      expect(text.match(SMART_QUOTES)).toBeNull();
      expect(text.match(EMOJI)).toBeNull();
    });
  }
});
