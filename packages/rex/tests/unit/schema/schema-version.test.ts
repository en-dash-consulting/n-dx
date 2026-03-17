import { describe, it, expect } from "vitest";
import {
  SCHEMA_VERSION,
  isCompatibleSchema,
  assertSchemaVersion,
} from "../../../src/schema/v1.js";
import { validateDocument } from "../../../src/schema/validate.js";

describe("isCompatibleSchema", () => {
  it("returns true for exact match", () => {
    expect(isCompatibleSchema(SCHEMA_VERSION)).toBe(true);
  });

  it("returns true for forward-compatible minor version", () => {
    expect(isCompatibleSchema("rex/v1.1")).toBe(true);
    expect(isCompatibleSchema("rex/v1.2.3")).toBe(true);
  });

  it("returns false for different major version", () => {
    expect(isCompatibleSchema("rex/v2")).toBe(false);
  });

  it("returns false for different prefix", () => {
    expect(isCompatibleSchema("other/v1")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isCompatibleSchema(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isCompatibleSchema("")).toBe(false);
  });

  it("returns false for partial prefix match without dot separator", () => {
    // "rex/v10" should NOT match "rex/v1" — it's a different major version
    expect(isCompatibleSchema("rex/v10")).toBe(false);
  });
});

describe("assertSchemaVersion", () => {
  it("does not throw for compatible schema", () => {
    expect(() => assertSchemaVersion({ schema: SCHEMA_VERSION })).not.toThrow();
  });

  it("does not throw for forward-compatible minor version", () => {
    expect(() => assertSchemaVersion({ schema: "rex/v1.1" })).not.toThrow();
  });

  it("throws for incompatible schema", () => {
    expect(() => assertSchemaVersion({ schema: "rex/v2" })).toThrow(
      /Incompatible PRD schema/,
    );
  });

  it("throws for missing schema", () => {
    expect(() => assertSchemaVersion({})).toThrow(/Incompatible PRD schema/);
  });

  it("includes expected version in error message", () => {
    expect(() => assertSchemaVersion({ schema: "bad" })).toThrow(
      SCHEMA_VERSION,
    );
  });

  it("suggests running rex validate", () => {
    expect(() => assertSchemaVersion({ schema: "bad" })).toThrow(
      /rex validate/,
    );
  });
});

describe("validateDocument schema version enforcement", () => {
  it("rejects document with incompatible schema version", () => {
    const result = validateDocument({
      schema: "rex/v2",
      title: "Test",
      items: [],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects document with wrong prefix", () => {
    const result = validateDocument({
      schema: "other/v1",
      title: "Test",
      items: [],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts document with exact schema version", () => {
    const result = validateDocument({
      schema: SCHEMA_VERSION,
      title: "Test",
      items: [],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts document with forward-compatible minor version", () => {
    const result = validateDocument({
      schema: "rex/v1.1",
      title: "Test",
      items: [],
    });
    expect(result.ok).toBe(true);
  });
});
