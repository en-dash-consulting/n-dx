// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { formatDisplayValue, coerceFieldValue, validateField, getPreviewImpact, CATEGORY_META, CATEGORY_ORDER } from "../../../src/viewer/views/hench-config.js";
import type { ConfigField } from "../../../src/viewer/views/hench-config.js";
// The server's field list is the contract this page renders. Importing it here
// is a test-only read of the other side of the boundary, not a runtime import:
// the category coverage check has nothing to compare against otherwise.
import { CONFIG_FIELD_META } from "../../../src/server/hench-config-fields.js";

// Rendering, editing and saving the work settings are covered on the page that
// hosts them: tests/unit/viewer/workflow.test.ts.

// ── Unit tests for pure helpers ──────────────────────────────────────

describe("formatDisplayValue", () => {
  it("joins arrays with comma", () => {
    expect(formatDisplayValue(["a", "b"])).toBe("a, b");
  });

  it("handles null/undefined", () => {
    expect(formatDisplayValue(null)).toBe("");
    expect(formatDisplayValue(undefined)).toBe("");
  });

  it("stringifies other values", () => {
    expect(formatDisplayValue(42)).toBe("42");
    expect(formatDisplayValue("hello")).toBe("hello");
  });
});

describe("coerceFieldValue", () => {
  const numberField: ConfigField = { path: "maxTurns", label: "Max Turns", description: "", type: "number", category: "execution", value: 50, defaultValue: 50, isDefault: true, impact: "" };
  const enumField: ConfigField = { path: "provider", label: "Provider", description: "", type: "enum", enumValues: ["cli", "api"], category: "execution", value: "cli", defaultValue: "cli", isDefault: true, impact: "" };
  const boolField: ConfigField = { path: "enabled", label: "Enabled", description: "", type: "boolean", category: "general", value: true, defaultValue: true, isDefault: true, impact: "" };
  const arrayField: ConfigField = { path: "guard.blockedPaths", label: "Blocked Paths", description: "", type: "array", category: "guard", value: [], defaultValue: [], isDefault: true, impact: "" };
  const stringField: ConfigField = { path: "model", label: "Model", description: "", type: "string", category: "execution", value: "sonnet", defaultValue: "sonnet", isDefault: true, impact: "" };

  it("coerces valid numbers", () => {
    expect(coerceFieldValue(numberField, "100")).toBe(100);
    expect(coerceFieldValue(numberField, "0")).toBe(0);
  });

  it("throws for invalid numbers", () => {
    expect(() => coerceFieldValue(numberField, "abc")).toThrow("must be a valid number");
    expect(() => coerceFieldValue(numberField, "")).toThrow("must be a valid number");
  });

  it("throws for negative numbers", () => {
    expect(() => coerceFieldValue(numberField, "-5")).toThrow("must be non-negative");
  });

  it("coerces valid enums", () => {
    expect(coerceFieldValue(enumField, "api")).toBe("api");
  });

  it("throws for invalid enums", () => {
    expect(() => coerceFieldValue(enumField, "invalid")).toThrow("must be one of: cli, api");
  });

  it("coerces booleans", () => {
    expect(coerceFieldValue(boolField, "true")).toBe(true);
    expect(coerceFieldValue(boolField, "false")).toBe(false);
  });

  it("coerces arrays from comma-separated string", () => {
    expect(coerceFieldValue(arrayField, "a, b, c")).toEqual(["a", "b", "c"]);
    expect(coerceFieldValue(arrayField, "")).toEqual([]);
  });

  it("coerces strings", () => {
    expect(coerceFieldValue(stringField, "opus")).toBe("opus");
  });

  it("throws for empty strings", () => {
    expect(() => coerceFieldValue(stringField, "")).toThrow("must not be empty");
    expect(() => coerceFieldValue(stringField, "   ")).toThrow("must not be empty");
  });
});

describe("validateField", () => {
  const numberField: ConfigField = { path: "maxTurns", label: "Max Turns", description: "", type: "number", category: "execution", value: 50, defaultValue: 50, isDefault: true, impact: "" };

  it("returns null for valid values", () => {
    expect(validateField(numberField, "100")).toBeNull();
  });

  it("returns error message for invalid values", () => {
    const err = validateField(numberField, "abc");
    expect(err).toContain("must be a valid number");
  });
});

describe("getPreviewImpact", () => {
  it("generates impact for maxTurns field", () => {
    const field: ConfigField = { path: "maxTurns", label: "Max Turns", description: "", type: "number", category: "execution", value: 50, defaultValue: 50, isDefault: true, impact: "" };
    expect(getPreviewImpact(field, "10")).toContain("10 turns");
    expect(getPreviewImpact(field, "10")).toContain("short");
  });

  it("returns empty string for invalid number", () => {
    const field: ConfigField = { path: "maxTurns", label: "Max Turns", description: "", type: "number", category: "execution", value: 50, defaultValue: 50, isDefault: true, impact: "" };
    expect(getPreviewImpact(field, "abc")).toBe("");
  });

  it("generates impact for array field", () => {
    const field: ConfigField = { path: "guard.allowedCommands", label: "Allowed Commands", description: "", type: "array", category: "guard", value: ["npm"], defaultValue: ["npm"], isDefault: true, impact: "" };
    expect(getPreviewImpact(field, "npm, git, tsc")).toContain("npm, git, tsc");
  });
});

/**
 * The Workflow page renders one section per category and, until this was
 * checked, iterated a hand-written order that the server's field list had
 * outgrown — a category missing from that array took every field in it off the
 * page while `GET /api/hench/config` went on serving them.
 */
describe("Workflow page category coverage", () => {
  it("names every category the server sends", () => {
    for (const field of CONFIG_FIELD_META) {
      expect(CATEGORY_ORDER, `${field.path} category "${field.category}"`).toContain(field.category);
      expect(CATEGORY_META[field.category], `heading for "${field.category}"`).toBeTruthy();
    }
  });

  it("has fields for every category it orders", () => {
    for (const category of CATEGORY_ORDER) {
      expect(
        CONFIG_FIELD_META.some((f) => f.category === category),
        `category "${category}" is ordered but no field uses it`,
      ).toBe(true);
    }
  });
});
