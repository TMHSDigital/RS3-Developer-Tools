import { describe, expect, it } from "vitest";
import { diffIndexes, renderDigest } from "../scripts/stubs-diff.mjs";

const sym = (name: string, kind: string, signature: string, url = `https://example.test/rs/${name.toLowerCase()}.html`) => ({ name, kind, signature, url, module: "m" });

describe("stubs-diff", () => {
  const before = {
    modules: [{ id: "core/a" }, { id: "core/gone" }],
    symbols: [sym("A", "class", "---@class A"), sym("A:Get", "method", "function A:Get(key: string): integer?"), sym("Old", "function", "function Old()")],
  };
  const after = {
    modules: [{ id: "core/a" }, { id: "core/new" }],
    symbols: [sym("A", "class", "---@class A"), sym("A:Get", "method", "function A:Get(key: string): integer"), sym("Event.Fresh", "event", "Event.Fresh.Subscribe(ref: string, callback: fun())")],
  };

  it("finds added, removed and changed symbols and pages", () => {
    const diff = diffIndexes(before, after);
    expect(diff.added.map((s) => s.name)).toEqual(["Event.Fresh"]);
    expect(diff.removed.map((s) => s.name)).toEqual(["Old"]);
    expect(diff.changed.map((c) => c.after.name)).toEqual(["A:Get"]);
    expect(diff.pagesAdded).toEqual(["core/new"]);
    expect(diff.pagesRemoved).toEqual(["core/gone"]);
  });

  it("renders a dated Markdown digest with docs links and nothing when unchanged", () => {
    const digest = renderDigest(diffIndexes(before, after), { date: "2026-10-27" });
    expect(digest.startsWith("## 2026-10-27")).toBe(true);
    expect(digest).toContain("1 added, 1 removed, 1 signature change(s), pages: +1 -1.");
    expect(digest).toContain("- `Event.Fresh` (event): `Event.Fresh.Subscribe(ref: string, callback: fun())` ([docs](https://example.test/rs/event.fresh.html))");
    expect(digest).toContain("- was: `function A:Get(key: string): integer?`");
    expect(digest).toContain("- now: `function A:Get(key: string): integer`");
    expect(renderDigest(diffIndexes(after, after))).toBe("");
  });
});
