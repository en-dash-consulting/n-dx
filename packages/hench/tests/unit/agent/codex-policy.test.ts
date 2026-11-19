import { describe, expect, it } from "vitest";
import { codexGuardLimitations } from "../../../src/agent/lifecycle/codex-policy.js";

describe("Codex guard capability reporting", () => {
  it("names unsupported CLI controls without claiming enforcement", () => {
    const reason = codexGuardLimitations("codex", "cli");
    expect(reason).toContain("allowedCommands");
    expect(reason).toContain("allowedGitSubcommands");
    expect(reason).toContain("blockedPaths");
    expect(reason).toContain("fresh, resumed and forked");
    expect(reason).toContain("no provider fallback");
  });

  it("keeps direct API execution available with its own tool guards", () => {
    expect(codexGuardLimitations("codex", "api")).toBeUndefined();
    expect(codexGuardLimitations("claude", "cli")).toBeUndefined();
  });

  it("reports a resolved Codex pair reviewer with a Claude executor", () => {
    expect(codexGuardLimitations("claude", "cli", "pair", "codex")).toContain("pair reviewer");
    for (const [provider, mode, reviewer] of [
      ["api", "pair", "codex"], ["cli", "off", "codex"],
      ["cli", "self", "codex"], ["cli", "pair", "claude"],
    ]) expect(codexGuardLimitations("claude", provider!, mode, reviewer)).toBeUndefined();
  });
});
