import { describe, it, expect } from "vitest";
import { validateRunSettings, validateDocument } from "../../../src/schema/validate.js";
import { RUN_SETTING_KEYS, SCHEMA_VERSION } from "../../../src/schema/v1.js";
import * as rexPublic from "../../../src/public.js";

const FULL = {
  tier: "heavy",
  models: { claude: "claude-opus-5-5", codex: "gpt-5.6-sol", google: "g", local: "l" },
  provider: "api",
  permissionMode: "bypassPermissions",
  review: false,
  reviewTier: "light",
  reviewModels: { codex: "gpt-5.6-mini" },
  reviewOptional: true,
  skipTestGate: false,
  maxTurns: 1,
  tokenBudget: Number.MAX_SAFE_INTEGER,
  contextNotes: "notes",
};

function rejects(input: unknown, key: string) {
  const r = validateRunSettings(input);
  expect(r.ok, JSON.stringify(input)).toBe(false);
  if (!r.ok) expect(r.error).toContain(`run.${key}`);
}

describe("validateRunSettings", () => {
  it("is exported from the public API with RUN_SETTING_KEYS", () => {
    expect(rexPublic.validateRunSettings).toBe(validateRunSettings);
    expect(rexPublic.RUN_SETTING_KEYS).toBe(RUN_SETTING_KEYS);
  });

  it("knows exactly the twelve run keys", () => {
    expect([...RUN_SETTING_KEYS].sort()).toEqual(Object.keys(FULL).sort());
  });

  it("accepts every key at its bounds and keeps false and zero", () => {
    expect(validateRunSettings(FULL)).toEqual({ ok: true, value: FULL });
    expect(validateRunSettings({ maxTurns: 500, tokenBudget: 0 })).toEqual({
      ok: true,
      value: { maxTurns: 500, tokenBudget: 0 },
    });
  });

  it("normalises {}, undefined, null and all-undefined keys to no block", () => {
    for (const input of [{}, undefined, null, { tier: undefined }, { models: {} }, { reviewModels: {} }]) {
      expect(validateRunSettings(input)).toEqual({ ok: true, value: undefined });
    }
  });

  it("rejects unknown keys, including launch-time options", () => {
    for (const key of ["colour", "fresh", "allowDirty", "resetDeferred", "workspace"]) {
      const r = validateRunSettings({ [key]: true });
      expect(r.ok, key).toBe(false);
    }
  });

  it("rejects the removed model and reviewModel keys, naming the valid keys", () => {
    for (const key of ["model", "reviewModel"]) {
      const r = validateRunSettings({ [key]: "claude-opus-5-5" });
      expect(r.ok, key).toBe(false);
      if (!r.ok) {
        expect(r.error).toContain(`"${key}"`);
        expect(r.error).toContain("tier, models,");
      }
    }
  });

  it("rejects an unknown vendor, naming the valid vendors", () => {
    for (const key of ["models", "reviewModels"]) {
      const r = validateRunSettings({ [key]: { openai: "gpt-x" } });
      expect(r.ok, key).toBe(false);
      if (!r.ok) {
        expect(r.error).toContain(`run.${key}.openai`);
        expect(r.error).toContain("claude, codex, google, local");
      }
    }
  });

  it("drops an empty models object but keeps the rest of the block", () => {
    expect(validateRunSettings({ tier: "light", models: {} })).toEqual({ ok: true, value: { tier: "light" } });
  });

  it("rejects wrong types and out-of-range values", () => {
    rejects({ review: "true" }, "review");
    rejects({ reviewOptional: 1 }, "reviewOptional");
    rejects({ skipTestGate: null }, "skipTestGate");
    rejects({ provider: "web" }, "provider");
    rejects({ permissionMode: "plan" }, "permissionMode");
    rejects({ maxTurns: 0 }, "maxTurns");
    rejects({ maxTurns: 501 }, "maxTurns");
    rejects({ maxTurns: 2.5 }, "maxTurns");
    rejects({ tokenBudget: -1 }, "tokenBudget");
    rejects({ tokenBudget: Number.MAX_SAFE_INTEGER + 2 }, "tokenBudget");
    rejects({ tier: "huge" }, "tier");
    rejects({ reviewTier: "free" }, "reviewTier");
    rejects({ models: { claude: 42 } }, "models.claude");
    rejects({ models: { claude: "" } }, "models.claude");
    rejects({ models: "claude-opus-5-5" }, "models");
  });

  it("measures string limits in UTF-8 bytes", () => {
    expect(validateRunSettings({ models: { claude: "a".repeat(256) } }).ok).toBe(true);
    rejects({ models: { claude: "a".repeat(257) } }, "models.claude");
    rejects({ reviewModels: { codex: "é".repeat(129) } }, "reviewModels.codex");
    expect(validateRunSettings({ contextNotes: "a".repeat(8192) }).ok).toBe(true);
    rejects({ contextNotes: "€".repeat(2731) }, "contextNotes");
  });

  it("rejects a non-object", () => {
    for (const input of ["fast", 1, [], true]) {
      expect(validateRunSettings(input).ok, JSON.stringify(input)).toBe(false);
    }
  });
});

describe("validateDocument: run", () => {
  const doc = (run: unknown) => ({
    schema: SCHEMA_VERSION,
    title: "T",
    items: [{ id: "a", title: "A", status: "pending", level: "task", run }],
  });

  it("accepts any plain-object block (writers validate, the document stays lenient)", () => {
    expect(validateDocument(doc({ review: true })).ok).toBe(true);
    expect(validateDocument(doc({ review: "yes" })).ok).toBe(true);
    expect(validateDocument(doc({ vendor: "codex" })).ok).toBe(true);
  });

  it("still rejects a run that is not an object", () => {
    expect(validateDocument(doc("fast")).ok).toBe(false);
    expect(validateDocument(doc([1])).ok).toBe(false);
  });
});
