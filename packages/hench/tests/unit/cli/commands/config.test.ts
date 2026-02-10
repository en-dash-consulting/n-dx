import { describe, it, expect } from "vitest";
import {
  getConfigValue,
  setConfigValue,
  coerceValue,
  previewChange,
  formatConfigDisplay,
  CONFIG_FIELDS,
} from "../../../../src/cli/commands/config.js";
import { DEFAULT_HENCH_CONFIG } from "../../../../src/schema/v1.js";
import type { HenchConfig } from "../../../../src/schema/v1.js";

describe("getConfigValue", () => {
  const config = DEFAULT_HENCH_CONFIG();

  it("reads top-level values", () => {
    expect(getConfigValue(config, "provider")).toBe("cli");
    expect(getConfigValue(config, "model")).toBe("sonnet");
    expect(getConfigValue(config, "maxTurns")).toBe(50);
  });

  it("reads nested values", () => {
    expect(getConfigValue(config, "retry.maxRetries")).toBe(3);
    expect(getConfigValue(config, "retry.baseDelayMs")).toBe(2000);
    expect(getConfigValue(config, "guard.commandTimeout")).toBe(30000);
  });

  it("returns undefined for nonexistent paths", () => {
    expect(getConfigValue(config, "nonexistent")).toBeUndefined();
    expect(getConfigValue(config, "retry.nonexistent")).toBeUndefined();
    expect(getConfigValue(config, "a.b.c.d")).toBeUndefined();
  });

  it("reads array values", () => {
    const commands = getConfigValue(config, "guard.allowedCommands");
    expect(Array.isArray(commands)).toBe(true);
    expect(commands).toContain("npm");
  });
});

describe("setConfigValue", () => {
  it("sets top-level values", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const updated = setConfigValue(config, "model", "opus");
    expect(updated.model).toBe("opus");
    // Original unmodified
    expect(config.model).toBe("sonnet");
  });

  it("sets nested values", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const updated = setConfigValue(config, "retry.maxRetries", 5);
    expect(updated.retry.maxRetries).toBe(5);
    expect(config.retry.maxRetries).toBe(3);
  });

  it("sets deeply nested guard values", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const updated = setConfigValue(config, "guard.commandTimeout", 60000);
    expect(updated.guard.commandTimeout).toBe(60000);
  });

  it("sets array values", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const updated = setConfigValue(config, "guard.allowedCommands", ["npm", "git"]);
    expect(updated.guard.allowedCommands).toEqual(["npm", "git"]);
  });
});

describe("coerceValue", () => {
  const findField = (path: string) => CONFIG_FIELDS.find((f) => f.path === path)!;

  it("coerces number strings", () => {
    expect(coerceValue("42", findField("maxTurns"))).toBe(42);
    expect(coerceValue("0", findField("tokenBudget"))).toBe(0);
  });

  it("throws on invalid numbers", () => {
    expect(() => coerceValue("abc", findField("maxTurns"))).toThrow();
  });

  it("coerces enum values", () => {
    expect(coerceValue("cli", findField("provider"))).toBe("cli");
    expect(coerceValue("api", findField("provider"))).toBe("api");
  });

  it("throws on invalid enum values", () => {
    expect(() => coerceValue("invalid", findField("provider"))).toThrow();
  });

  it("coerces comma-separated arrays", () => {
    const result = coerceValue("npm,git,tsc", findField("guard.allowedCommands"));
    expect(result).toEqual(["npm", "git", "tsc"]);
  });

  it("trims array items", () => {
    const result = coerceValue("npm , git , tsc", findField("guard.allowedCommands"));
    expect(result).toEqual(["npm", "git", "tsc"]);
  });

  it("filters empty array items", () => {
    const result = coerceValue("npm,,git,", findField("guard.allowedCommands"));
    expect(result).toEqual(["npm", "git"]);
  });

  it("returns strings as-is", () => {
    expect(coerceValue("opus", findField("model"))).toBe("opus");
  });
});

describe("previewChange", () => {
  it("returns impact for known fields", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const preview = previewChange(config, "provider", "api");
    expect(preview).not.toBeNull();
    expect(preview!.impact).toContain("API");
    expect(preview!.oldValue).toBe("cli");
    expect(preview!.newValue).toBe("api");
  });

  it("returns null for unknown fields", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const preview = previewChange(config, "nonexistent", "foo");
    expect(preview).toBeNull();
  });

  it("includes impact for maxTurns", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const preview = previewChange(config, "maxTurns", 10);
    expect(preview!.impact).toContain("10 turns");
  });

  it("includes impact for tokenBudget=0 (unlimited)", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const preview = previewChange(config, "tokenBudget", 0);
    expect(preview!.impact).toContain("unlimited");
  });

  it("includes impact for tokenBudget > 0", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const preview = previewChange(config, "tokenBudget", 100000);
    expect(preview!.impact).toContain("100,000");
  });
});

describe("formatConfigDisplay", () => {
  it("displays all categories", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const display = formatConfigDisplay(config);
    expect(display).toContain("Execution Strategy");
    expect(display).toContain("Retry Policy");
    expect(display).toContain("Guard Rails");
    expect(display).toContain("Task Selection");
    expect(display).toContain("General");
  });

  it("shows field labels and values", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const display = formatConfigDisplay(config);
    expect(display).toContain("Provider");
    expect(display).toContain("cli");
    expect(display).toContain("Model");
    expect(display).toContain("sonnet");
  });

  it("marks modified fields with asterisk", () => {
    const config = DEFAULT_HENCH_CONFIG();
    config.model = "opus";
    const display = formatConfigDisplay(config);
    // Modified field gets *
    expect(display).toContain("* Model");
  });

  it("includes usage hints", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const display = formatConfigDisplay(config);
    expect(display).toContain("--interactive");
  });
});

describe("CONFIG_FIELDS", () => {
  it("has impact functions for all fields", () => {
    for (const field of CONFIG_FIELDS) {
      expect(typeof field.impact).toBe("function");
      // Should not throw when called with a sample value
      const config = DEFAULT_HENCH_CONFIG();
      const value = getConfigValue(config, field.path);
      const impact = field.impact(value);
      expect(typeof impact).toBe("string");
      expect(impact.length).toBeGreaterThan(0);
    }
  });

  it("has valid categories for all fields", () => {
    const validCategories = new Set(["execution", "retry", "guard", "task-selection", "general"]);
    for (const field of CONFIG_FIELDS) {
      expect(validCategories.has(field.category)).toBe(true);
    }
  });

  it("covers all major config paths", () => {
    const paths = CONFIG_FIELDS.map((f) => f.path);
    expect(paths).toContain("provider");
    expect(paths).toContain("model");
    expect(paths).toContain("maxTurns");
    expect(paths).toContain("retry.maxRetries");
    expect(paths).toContain("guard.allowedCommands");
    expect(paths).toContain("guard.blockedPaths");
    expect(paths).toContain("maxFailedAttempts");
  });
});
