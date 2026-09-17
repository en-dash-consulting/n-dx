import { describe, it, expect } from "vitest";
import {
  CONFIG_FIELD_META,
  validateConfigKeyValue,
  validateFieldValue,
  type ConfigFieldInfo,
} from "../../../src/server/hench-config-fields.js";

/**
 * The dashboard's config gate must be at least as strict as hench's
 * `HenchConfigSchema`, because anything it accepts is written to
 * `.hench/config.json` and hench refuses to load a file its schema rejects.
 *
 * The cross-package agreement itself is pinned by
 * `tests/e2e/hench-config-gate-contract.test.js`, which probes both sides.
 * What is asserted here is the gate's own behaviour on the shapes that used to
 * slip through — coercion through `String(value)`, unchecked array elements,
 * and numbers that are zero, fractional, or not finite.
 */
describe("validateConfigKeyValue", () => {
  /** Look up the declared metadata for a field, failing loudly if it moved. */
  function field(path: string): ConfigFieldInfo {
    const found = CONFIG_FIELD_META.find((f) => f.path === path);
    if (!found) throw new Error(`No CONFIG_FIELD_META entry for "${path}"`);
    return found;
  }

  describe("enum fields", () => {
    it("rejects a non-string value that coerces to a valid member", () => {
      // String(["cli"]) === "cli", so the old includes(String(value)) check
      // passed an array straight through to a z.enum(["cli", "api"]) field.
      expect(validateConfigKeyValue("provider", ["cli"])).toBeTruthy();
    });

    it("rejects every other non-string shape", () => {
      for (const value of [1, true, null, { toString: () => "cli" }, ["cli", "api"]]) {
        expect(validateConfigKeyValue("provider", value), JSON.stringify(value)).toBeTruthy();
      }
    });

    it("still accepts the declared members", () => {
      expect(validateConfigKeyValue("provider", "cli")).toBeNull();
      expect(validateConfigKeyValue("provider", "api")).toBeNull();
    });

    it("still rejects an unknown member and names the allowed values", () => {
      expect(validateConfigKeyValue("provider", "codex")).toContain("cli, api");
    });
  });

  describe("array fields", () => {
    it("rejects an array whose elements are not all strings", () => {
      // z.array(z.string()) — Array.isArray alone let [1, null] through.
      expect(validateConfigKeyValue("guard.allowedCommands", [1, null])).toBeTruthy();
      expect(validateConfigKeyValue("guard.blockedPaths", ["ok", 2])).toBeTruthy();
      expect(validateConfigKeyValue("guard.allowedCommands", [["npm"]])).toBeTruthy();
      expect(validateConfigKeyValue("guard.allowedCommands", [{ cmd: "npm" }])).toBeTruthy();
    });

    it("still rejects a non-array", () => {
      expect(validateConfigKeyValue("guard.allowedCommands", "npm")).toBeTruthy();
    });

    it("accepts an all-string array, including the empty array", () => {
      expect(validateConfigKeyValue("guard.allowedCommands", ["npm", "git"])).toBeNull();
      expect(validateConfigKeyValue("guard.blockedPaths", [])).toBeNull();
    });
  });

  describe("number fields", () => {
    it("rejects non-finite numbers", () => {
      // JSON.parse('1e999') is Infinity, and JSON.stringify(Infinity) is "null"
      // — the written file would not even hold a number.
      for (const path of ["guard.commandTimeout", "maxTurns", "tokenBudget"]) {
        expect(validateConfigKeyValue(path, Infinity), `${path} Infinity`).toBeTruthy();
        expect(validateConfigKeyValue(path, -Infinity), `${path} -Infinity`).toBeTruthy();
        expect(validateConfigKeyValue(path, NaN), `${path} NaN`).toBeTruthy();
      }
      expect(JSON.parse("1e999")).toBe(Infinity);
    });

    it("rejects zero for a field hench marks .positive()", () => {
      expect(validateConfigKeyValue("guard.commandTimeout", 0)).toBeTruthy();
      expect(validateConfigKeyValue("guard.maxFileSize", 0)).toBeTruthy();
      expect(validateConfigKeyValue("maxTurns", 0)).toBeTruthy();
      expect(validateConfigKeyValue("maxTokens", 0)).toBeTruthy();
      expect(validateConfigKeyValue("retry.baseDelayMs", 0)).toBeTruthy();
      expect(validateConfigKeyValue("retry.maxDelayMs", 0)).toBeTruthy();
      expect(validateConfigKeyValue("maxFailedAttempts", 0)).toBeTruthy();
    });

    it("accepts zero for a field hench marks only .nonnegative()", () => {
      // tokenBudget 0 means "unlimited" and loopPauseMs 0 means "no pause".
      expect(validateConfigKeyValue("tokenBudget", 0)).toBeNull();
      expect(validateConfigKeyValue("loopPauseMs", 0)).toBeNull();
      expect(validateConfigKeyValue("retry.maxRetries", 0)).toBeNull();
    });

    it("rejects a fractional value for a field hench marks .int()", () => {
      expect(validateConfigKeyValue("maxFailedAttempts", 2.5)).toBeTruthy();
      expect(validateConfigKeyValue("tokenBudget", 1.5)).toBeTruthy();
      expect(validateConfigKeyValue("loopPauseMs", 1000.5)).toBeTruthy();
      expect(validateConfigKeyValue("retry.maxRetries", 0.5)).toBeTruthy();
    });

    it("still rejects negatives and non-numbers", () => {
      expect(validateConfigKeyValue("tokenBudget", -1)).toBeTruthy();
      expect(validateConfigKeyValue("maxTurns", "lots")).toBeTruthy();
      expect(validateConfigKeyValue("maxTurns", null)).toBeTruthy();
    });

    it("still accepts ordinary values", () => {
      expect(validateConfigKeyValue("maxTurns", 50)).toBeNull();
      expect(validateConfigKeyValue("guard.commandTimeout", 45000)).toBeNull();
      expect(validateConfigKeyValue("retry.maxRetries", 7)).toBeNull();
    });
  });

  describe("key allowlist", () => {
    it("still rejects an unknown field and a prototype segment", () => {
      expect(validateConfigKeyValue("permissionMode", "bypassPermissions")).toBeTruthy();
      expect(validateConfigKeyValue("__proto__.polluted", 1)).toBeTruthy();
    });
  });

  describe("metadata", () => {
    it("declares integer/positive only on number fields", () => {
      for (const f of CONFIG_FIELD_META) {
        if (f.type === "number") continue;
        expect(f.integer, `${f.path}.integer`).toBeUndefined();
        expect(f.positive, `${f.path}.positive`).toBeUndefined();
      }
    });

    it("gives every enum field its list of members", () => {
      for (const f of CONFIG_FIELD_META) {
        if (f.type !== "enum") continue;
        expect(f.enumValues?.length, `${f.path}.enumValues`).toBeGreaterThan(0);
      }
    });

    it("rejects a boolean field's non-boolean value", () => {
      // No boolean field is writable today; the branch is still reachable if
      // one is added, so pin it rather than leave it untested.
      const synthetic: ConfigFieldInfo = {
        path: "autoCommit",
        label: "Auto Commit",
        description: "",
        type: "boolean",
        category: "execution",
      };
      expect(validateFieldValue(synthetic, "true")).toBeTruthy();
      expect(validateFieldValue(synthetic, true)).toBeNull();
    });
  });
});
