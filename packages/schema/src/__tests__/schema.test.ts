import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { loadPluginSchema, PERMISSIONS } from "../index.js";

function compile() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(loadPluginSchema());
}

const good = {
  name: "Hello Counter",
  version: "0.1.0",
  contactEmailAddress: "plugin-contact@example.com",
  requiredDependencies: [],
  optionalDependencies: { Pretty: "PrettyUI" },
  requiredPermissions: [],
  optionalPermissions: ["httpAccess"],
  urls: { wiki: "https://runescape.wiki/" },
};

describe("plugin.schema.json", () => {
  it("is a valid draft 2020-12 schema that compiles in strict mode", () => {
    expect(() => compile()).not.toThrow();
  });

  it("accepts a complete manifest with both dependency forms", () => {
    const validate = compile();
    expect(validate(good)).toBe(true);
    expect(validate({ ...good, optionalDependencies: ["PrettyUI"] })).toBe(true);
  });

  it("accepts the minimal manifest from the tutorial", () => {
    const validate = compile();
    expect(
      validate({ name: "Tutorial plugin", version: "0.0.1", contactEmailAddress: "x@example.com" }),
    ).toBe(true);
  });

  it("rejects a missing contactEmailAddress", () => {
    const validate = compile();
    expect(validate({ name: "x", version: "1" })).toBe(false);
  });

  it("rejects an invalid email", () => {
    const validate = compile();
    expect(validate({ ...good, contactEmailAddress: "not-an-email" })).toBe(false);
  });

  it("rejects unknown permissions", () => {
    const validate = compile();
    expect(validate({ ...good, requiredPermissions: ["fileAccess"] })).toBe(false);
    expect(PERMISSIONS).toContain("httpAccess");
  });

  it("rejects non-http urls and non-identifier url keys", () => {
    const validate = compile();
    expect(validate({ ...good, urls: { wiki: "ftp://example.com" } })).toBe(false);
    expect(validate({ ...good, urls: { "my-key": "https://example.com" } })).toBe(false);
  });

  it("rejects unknown top-level fields but tolerates remote* fields", () => {
    const validate = compile();
    expect(validate({ ...good, author: "me" })).toBe(false);
    expect(validate({ ...good, remoteId: 12 })).toBe(true);
  });
});
