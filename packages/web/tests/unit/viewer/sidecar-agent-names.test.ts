import { describe, expect, it } from "vitest";
import { modelLabel, vendorLabel } from "../../../src/viewer/components/sidecar-agent-names.js";

describe("modelLabel", () => {
  it.each([
    ["claude-opus-5-5", "Opus 5.5"],
    ["claude-sonnet-5-5", "Sonnet 5.5"],
    ["claude-fable-5-1", "Fable 5.1"],
    ["claude-haiku-4-5", "Haiku 4.5"],
    ["claude-sonnet-5", "Sonnet 5"],
  ])("%s → %s", (id, name) => expect(modelLabel(id)).toBe(name));

  it("leaves other ids unchanged", () => {
    expect(modelLabel("gpt-5.5")).toBe("gpt-5.5");
    expect(modelLabel("gpt-5.5-mini")).toBe("gpt-5.5-mini");
    expect(modelLabel("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5-20251001");
    expect(modelLabel("")).toBe("");
  });
});

describe("vendorLabel", () => {
  it("names the two Sidecar vendors and passes others through", () => {
    expect(vendorLabel("claude")).toBe("Claude");
    expect(vendorLabel("codex")).toBe("Codex");
    expect(vendorLabel("google")).toBe("google");
  });
});
