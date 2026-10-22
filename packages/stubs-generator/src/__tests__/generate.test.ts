import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { DocsClient } from "@tmhs/rs3-devtools-core";
import * as path from "node:path";
import * as os from "node:os";
import { promises as fsp } from "node:fs";
import { generate, loadOverrides } from "../generate.js";
import { convertType, parseParam, stripAngleBrackets } from "../lua-types.js";
import { collapseWhitespace } from "../model.js";
import { checkCrawlGuard, readBaseline } from "../guard.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const fixturesNoNav = fileURLToPath(new URL("./fixtures-no-nav/", import.meta.url));

function client() {
  return new DocsClient({ offlineDir: fixtures, baseUrl: "https://example.test/rs/" });
}

async function run() {
  // Overrides target the real docs; an empty set keeps the fixture run self-contained.
  const overrides = { ...loadOverrides(), classParents: [], eventCallbackReturnsBoolean: [], extraFields: [], ownerPlaceholders: [], returnTypes: [], globalFunctions: [], aliases: [] };
  return generate({ client: client(), overrides });
}

describe("crawl guard", () => {
  it("fires on an index page without navigation and on a shrunken crawl", async () => {
    const empty = await generate({
      client: new DocsClient({ offlineDir: fixturesNoNav, baseUrl: "https://example.test/rs/" }),
      overrides: { ...loadOverrides(), classParents: [], eventCallbackReturnsBoolean: [], extraFields: [], ownerPlaceholders: [], returnTypes: [], globalFunctions: [], aliases: [] },
    });
    expect(empty.pageCount).toBe(0);
    expect(empty.modules).toEqual([]);
    const summary = { pageCount: empty.pageCount, modules: 0, symbols: 0, notes: 0 };
    const problems = checkCrawlGuard(summary, { modules: 87, symbols: 2503, notes: 123 });
    expect(problems.some((p) => /visited 0 page/.test(p))).toBe(true);
    expect(problems.some((p) => /modules dropped from 87 to 0/.test(p))).toBe(true);
    expect(problems.some((p) => /symbols dropped from 2503 to 0/.test(p))).toBe(true);
    // A normal weekly run: a few symbols more or fewer is fine.
    expect(checkCrawlGuard({ pageCount: 95, modules: 86, symbols: 2480, notes: 125 }, { modules: 87, symbols: 2503, notes: 123 })).toEqual([]);
    // Notes exploding means the parser stopped understanding pages.
    expect(checkCrawlGuard({ pageCount: 95, modules: 87, symbols: 2503, notes: 400 }, { modules: 87, symbols: 2503, notes: 123 })).toHaveLength(1);
    // The override skips every check.
    expect(checkCrawlGuard(summary, { modules: 87, symbols: 2503, notes: 123 }, { allowShrink: true })).toEqual([]);
    // Without a baseline only the page minimum applies.
    expect(checkCrawlGuard({ pageCount: 3, modules: 2, symbols: 10, notes: 0 }, undefined, { minPages: 3 })).toEqual([]);
  });

  it("reads the baseline counts from a written output folder", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "rs3-baseline-"));
    try {
      expect(await readBaseline(dir)).toBeUndefined();
      await fsp.writeFile(path.join(dir, "index.json"), JSON.stringify({ modules: [{}, {}], symbols: [{}, {}, {}] }));
      await fsp.writeFile(path.join(dir, "unresolved.md"), "# Report\n\n- one\n- two\n\nprose\n");
      expect(await readBaseline(dir)).toEqual({ modules: 2, symbols: 3, notes: 2 });
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("generate (synthetic fixtures)", () => {
  it("emits one meta file per API page and skips tutorial pages", async () => {
    const result = await run();
    const files = Object.keys(result.files).sort();
    expect(files).toContain("stubs/core/sample.lua");
    expect(files).toContain("stubs/ui/widget.lua");
    expect(files.some((f) => f.includes("tutorial"))).toBe(false);
    for (const file of files.filter((f) => f.endsWith(".lua"))) {
      expect(result.files[file]!.startsWith("---@meta\n")).toBe(true);
    }
  });

  it("renders enums, methods, overloads, converted types and docs links", async () => {
    const result = await run();
    const sample = result.files["stubs/core/sample.lua"]!;
    expect(sample).toContain("---@enum SampleKind");
    expect(sample).toContain("    FIRST = 0,");
    expect(sample).toContain("---@class SampleMode\n---@field FAST SampleMode\n---@field SLOW SampleMode");
    expect(sample).toContain("---@see https://example.test/rs/core/sample.html#get\n---@param key string\n---@return integer?\nfunction Sample:Get(key) end");
    expect(sample).toContain("---@overload fun(count: integer): Sample");
    expect(sample).toContain("function Sample.Make() end");
    expect(sample).toContain("---@param callback fun(key: string, value: boolean|integer): boolean");
    expect(sample).toContain("---@field isValid boolean");
    expect(sample).toContain("---@field items ui.Widget[]");
    expect(sample).toContain("---@field pair [integer, integer]");
    // Sample is used as a table in the examples, so it is a global.
    expect(sample).toContain("\nSample = {}");
  });

  it("resolves unqualified ui types, parents, and global namespaces", async () => {
    const result = await run();
    const widget = result.files["stubs/ui/widget.lua"]!;
    expect(widget).toContain("---@class ui.Widget : ui.Component");
    expect(widget).toContain("---@return ui.Widget");
    expect(widget).toContain("function ui.Widget:Poke(times) end");
    expect(result.files["stubs/_namespaces.lua"]).toContain("\nui = {}");
    expect(result.files["stubs/_unresolved.lua"]).toContain("---@alias Thing any");
    expect(result.files["stubs/_unresolved.lua"]).toContain("---@alias ui.ComponentCollection any");
  });

  it("never copies documentation prose into the output", async () => {
    const result = await run();
    for (const [file, content] of Object.entries(result.files)) {
      if (file === "unresolved.md") continue;
      expect(content, file).not.toMatch(/PROSE_MARKER/);
    }
  });

  it("ignores signatures inside example admonitions", async () => {
    const result = await run();
    expect(JSON.stringify(result.files)).not.toContain("NotARealSignature");
  });

  it("produces a sorted lookup index with docs URLs", async () => {
    const result = await run();
    const names = result.index.map((e) => e.name);
    expect(names).toEqual([...names].sort());
    const get = result.index.find((e) => e.name === "Sample:Get");
    expect(get?.kind).toBe("method");
    expect(get?.url).toBe("https://example.test/rs/core/sample.html#get");
    expect(get?.signature).toBe("function Sample:Get(key: string): integer?");
  });

  it("is deterministic", async () => {
    const a = await run();
    const b = await run();
    expect(a.files).toEqual(b.files);
    expect(JSON.stringify(a.notes)).toBe(JSON.stringify(b.notes));
  });
});

describe("pathological input stays linear", () => {
  it("converts 100 KB strings of repeated delimiters within a time budget", () => {
    const budgetMs = 500;
    const inputs = [
      "{ " + " ".repeat(100000) + "x",
      "[ " + "[".repeat(50000) + " ]",
      "( " + "(".repeat(50000),
      "function " + " ".repeat(100000) + "(",
      "Component" + "<".repeat(100000),
      "<a".repeat(50000) + ">".repeat(50000),
      "String" + " ".repeat(100000) + "Properties",
    ];
    const started = Date.now();
    for (const input of inputs) {
      const out = convertType(input);
      expect(typeof out.type).toBe("string");
    }
    expect(stripAngleBrackets("Component<Map<K, V>>Rest")).toBe("ComponentRest");
    expect(stripAngleBrackets("<<a>>b")).toBe("b");
    expect(collapseWhitespace("  a \t\n b  ")).toBe("a b");
    expect(Date.now() - started).toBeLessThan(budgetMs);
  });
});

describe("convertType", () => {
  it("maps primitives and optional markers", () => {
    expect(convertType("String")).toMatchObject({ type: "string", optional: false });
    expect(convertType("Int?")).toMatchObject({ type: "integer", optional: true });
    expect(convertType("Uint8")).toMatchObject({ type: "integer" });
    expect(convertType("Float")).toMatchObject({ type: "number" });
  });

  it("handles arrays, unions, maps, tuples and generics", () => {
    expect(convertType("[ NPCEntity ]").type).toBe("NPCEntity[]");
    expect(convertType("Bool/Int/Float/String/Table").type).toBe("boolean|integer|number|string|table");
    expect(convertType("{ Int -> [ Uint16 ] }").type).toBe("table<integer, integer[]>");
    expect(convertType("(Int, Int)").type).toBe("[integer, integer]");
    expect(convertType("[ [ Integer, Obj ] ]").type).toBe("[integer, Obj][]");
    expect(convertType("Component<T>")).toMatchObject({ type: "Component", references: ["Component"] });
  });

  it("converts function types", () => {
    expect(convertType("function (key : String, value : Bool) -> Bool").type).toBe("fun(key: string, value: boolean): boolean");
    expect(convertType("function? (self : HTTPRequest)")).toMatchObject({ type: "fun(self: HTTPRequest)", optional: true });
  });

  it("flags prose cells as malformed", () => {
    expect(convertType("True if this sound is currently paused.").malformed).toBe(true);
  });

  it("parses parameters including varargs and reserved words", () => {
    expect(parseParam("args : ...")).toMatchObject({ name: "args", vararg: true });
    expect(parseParam("type : PersistentDBType").name).toBe("type");
    expect(parseParam("end : Int").name).toBe("end_");
  });
});
