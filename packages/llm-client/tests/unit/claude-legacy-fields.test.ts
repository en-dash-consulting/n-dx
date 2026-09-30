/**
 * Per-field resolution of the legacy top-level `claude.*` keys against the
 * modern `llm.claude.*` block.
 *
 * Until 1.0.0 both locations are read. The rule is `new ?? old` **per field**,
 * not per block: before this, an `llm.claude` holding only `model` shadowed the
 * whole legacy block, so a project that had set `claude.api_key` years ago and
 * later pinned a model in `llm.claude` silently lost its key. That is the
 * behaviour change these cases pin — every field is resolved on its own.
 *
 * @see src/llm-config.ts — resolveClaudeConfig
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveClaudeConfig, loadLLMConfig } from "../../src/llm-config.js";

/** Every field the legacy top-level `claude` block could carry. */
const FIELDS = ["model", "lightModel", "cli_path", "api_key", "api_endpoint"] as const;

/** A distinguishable value per field, so a cross-wired field is visible. */
const MODERN = {
  model: "modern-model",
  lightModel: "modern-light",
  cli_path: "/modern/claude",
  api_key: "sk-modern",
  api_endpoint: "https://modern.example",
} as const;

const LEGACY = {
  model: "legacy-model",
  lightModel: "legacy-light",
  cli_path: "/legacy/claude",
  api_key: "sk-legacy",
  api_endpoint: "https://legacy.example",
} as const;

describe("resolveClaudeConfig: per-field new ?? old", () => {
  for (const field of FIELDS) {
    it(`${field}: new-only resolves to the llm.claude value`, () => {
      const { config, sources } = resolveClaudeConfig({ [field]: MODERN[field] }, undefined);
      expect(config?.[field]).toBe(MODERN[field]);
      expect(sources[field]).toBe("llm");
    });

    it(`${field}: old-only resolves to the legacy value`, () => {
      const { config, sources } = resolveClaudeConfig(undefined, { [field]: LEGACY[field] });
      expect(config?.[field]).toBe(LEGACY[field]);
      expect(sources[field]).toBe("legacy");
    });

    it(`${field}: both set resolves to the llm.claude value`, () => {
      const { config, sources } = resolveClaudeConfig(
        { [field]: MODERN[field] },
        { [field]: LEGACY[field] },
      );
      expect(config?.[field]).toBe(MODERN[field]);
      expect(sources[field]).toBe("llm");
    });
  }

  it("resolves each field independently — a partial modern block does not shadow the rest", () => {
    // The regression this whole change exists for.
    const { config, sources } = resolveClaudeConfig({ model: MODERN.model }, LEGACY);
    expect(config?.model).toBe(MODERN.model);
    expect(sources.model).toBe("llm");
    for (const field of FIELDS.filter((f) => f !== "model")) {
      expect(config?.[field]).toBe(LEGACY[field]);
      expect(sources[field]).toBe("legacy");
    }
  });

  it("returns undefined and no sources when neither location has anything", () => {
    expect(resolveClaudeConfig(undefined, undefined)).toEqual({ config: undefined, sources: {} });
    expect(resolveClaudeConfig({}, {})).toEqual({ config: undefined, sources: {} });
  });

  it("ignores empty and non-string values in either location", () => {
    // An empty string is how the dashboard used to clear a field; it must not
    // win over a legacy value that is actually set.
    const { config, sources } = resolveClaudeConfig(
      { model: "", api_key: 42 },
      { model: LEGACY.model, api_key: LEGACY.api_key },
    );
    expect(config?.model).toBe(LEGACY.model);
    expect(config?.api_key).toBe(LEGACY.api_key);
    expect(sources.model).toBe("legacy");
  });

  it("accepts non-object inputs without throwing", () => {
    expect(resolveClaudeConfig(null, "nonsense")).toEqual({ config: undefined, sources: {} });
  });
});

describe("loadLLMConfig: legacy claude fields survive a partial llm.claude block", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "llm-claude-legacy-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("honours each legacy field the llm.claude block leaves unset", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        claude: { cli_path: "/legacy/claude", api_key: "sk-legacy", model: "legacy-model" },
        llm: { claude: { model: "modern-model" } },
      }, null, 2),
      "utf-8",
    );

    const cfg = await loadLLMConfig(tmpDir);
    expect(cfg.claude?.model).toBe("modern-model");
    expect(cfg.claude?.cli_path).toBe("/legacy/claude");
    expect(cfg.claude?.api_key).toBe("sk-legacy");
  });
});
