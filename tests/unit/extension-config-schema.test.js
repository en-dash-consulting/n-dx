/**
 * The JSON Schema check behind an extension's `configSchema`
 * (packages/core/extension-config-schema.js). `ndx config extensions.<name>`
 * and the run-time refusal through the real CLI are in
 * tests/e2e/cli-extensions.test.js.
 *
 * @see docs/architecture/extensions.md — "Config"
 */

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { compileConfigSchema, configCheckerFor } from "../../packages/core/extension-config-schema.js";

const messages = (schema, value) => compileConfigSchema(schema)(value).map((v) => v.message);

describe("compileConfigSchema", () => {
  it("accepts a value that meets every rule", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "recon",
      type: "object",
      properties: {
        mode: { enum: ["fast", "deep"], default: "fast" },
        depth: { type: "integer", minimum: 1, maximum: 9 },
        url: { type: "string", format: "uri", pattern: "^https://" },
        tags: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true, maxItems: 3 },
        ratio: { type: "number", multipleOf: 0.1 },
      },
      required: ["mode"],
      additionalProperties: false,
    };
    expect(messages(schema, { mode: "deep", depth: 9, url: "https://x", tags: ["a", "b"], ratio: 0.3 })).toEqual([]);
  });

  it("names each broken rule with the dotted path of the value", () => {
    const schema = {
      type: "object",
      properties: {
        mode: { enum: ["fast", "deep"] },
        depth: { type: "integer", minimum: 1 },
        nested: { type: "object", properties: { host: { type: "string", maxLength: 3 } } },
        tags: { type: "array", items: { type: "string" }, uniqueItems: true },
      },
      required: ["target"],
      additionalProperties: false,
    };
    const violations = compileConfigSchema(schema)({
      mode: "slow",
      depth: 0,
      nested: { host: "example" },
      tags: ["a", 1, "a"],
      extra: true,
    });
    expect(violations).toEqual([
      { keyword: "required", message: 'the section must have the property "target"' },
      { keyword: "enum", message: 'mode must be one of: "fast", "deep"' },
      { keyword: "minimum", message: "depth must be >= 1" },
      { keyword: "maxLength", message: "nested.host must have at most 3 characters" },
      { keyword: "uniqueItems", message: "tags must not repeat items" },
      { keyword: "type", message: "tags.1 must be string" },
      { keyword: "additionalProperties", message: 'the section must not have the property "extra"' },
    ]);
  });

  it("stops at a wrong type rather than reporting rules for another type", () => {
    expect(messages({ type: ["string", "null"], minLength: 2 }, 4)).toEqual(["the section must be string or null"]);
    expect(messages({ type: "integer" }, 1.5)).toEqual(["the section must be integer"]);
  });

  it("checks additionalProperties given as a schema, and the combinators", () => {
    expect(messages({ additionalProperties: { type: "number" } }, { a: 1, b: "x" })).toEqual(["b must be number"]);
    expect(messages({ anyOf: [{ type: "string" }, { type: "number" }] }, true)).toEqual(["the section must match one of the anyOf schemas"]);
    expect(messages({ oneOf: [{ type: "number" }, { type: "integer" }] }, 2)).toEqual(["the section must match exactly one of the oneOf schemas"]);
    expect(messages({ allOf: [{ minimum: 2 }, { maximum: 1 }] }, 3)).toEqual(["the section must be <= 1"]);
    expect(messages({ not: { const: "root" } }, "root")).toEqual(['the section must not match the "not" schema']);
    expect(messages({ properties: { off: false } }, { off: 1 })).toEqual(["off is not allowed"]);
  });

  it("refuses a schema it cannot check, naming where", () => {
    expect(() => compileConfigSchema({ properties: { a: { $ref: "#/$defs/a" } } })).toThrow('#/properties/a/$ref: "$ref" is not a keyword n-dx checks');
    expect(() => compileConfigSchema({ items: [{ type: "string" }] })).toThrow("#/items: tuple items are not supported");
    expect(() => compileConfigSchema({ type: "text" })).toThrow("#/type must name JSON types");
    expect(() => compileConfigSchema({ pattern: "(" })).toThrow("#/pattern is not a valid pattern");
    expect(() => compileConfigSchema({ anyOf: [] })).toThrow("#/anyOf must be a non-empty array of schemas");
    expect(() => compileConfigSchema("object")).toThrow("# is not a schema");
  });
});

describe("configCheckerFor", () => {
  const ext = (configSchema) => ({ name: "recon", dir: "/ext/recon", manifest: { name: "recon", configSchema } });
  const fsWith = (files) => ({
    readFileSync: (path) => {
      if (!(path in files)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return files[path];
    },
  });
  const schemaPath = join("/ext/recon", "schema.json");

  it("has nothing to check when the manifest names no schema", () => {
    const checker = configCheckerFor(ext(undefined), fsWith({}));
    expect(checker.check({ anything: 1 })).toEqual([]);
    expect(checker.typeAt(["anything"])).toBeUndefined();
  });

  it("reads the schema from the package and reports declared types", () => {
    const schema = { properties: { target: { type: "string" }, nested: { properties: { port: { type: "integer" } } } } };
    const checker = configCheckerFor(ext("schema.json"), fsWith({ [schemaPath]: JSON.stringify(schema) }));
    expect(checker.typeAt(["target"])).toBe("string");
    expect(checker.typeAt(["nested", "port"])).toBe("integer");
    expect(checker.typeAt(["other"])).toBeUndefined();
    expect(checker.check({ target: 1 })).toEqual([{ keyword: "type", message: "target must be string" }]);
  });

  it("turns an unreadable or uncheckable schema into one violation", () => {
    expect(configCheckerFor(ext("schema.json"), fsWith({})).check({})).toEqual([
      { keyword: "schema", message: `its configSchema ${schemaPath} cannot be read (ENOENT)` },
    ]);
    const [violation] = configCheckerFor(ext("schema.json"), fsWith({ [schemaPath]: '{"$ref": "#/x"}' })).check({});
    expect(violation.keyword).toBe("schema");
    expect(violation.message).toContain("cannot be checked");
  });
});
