/**
 * Unit tests for the canonical re-authentication guidance helper.
 */

import { describe, it, expect } from "vitest";
import {
  authFailureGuidance,
  authFailureMessage,
  VERIFY_CREDENTIALS_STEP,
} from "../../src/auth-guidance.js";

describe("authFailureGuidance", () => {
  it("names Claude and gives the logout/login remediation", () => {
    const g = authFailureGuidance("claude");
    expect(g.provider).toBe("Claude");
    expect(g.headline).toBe(
      "Authentication failed for Claude — Invalid or expired credentials.",
    );
    expect(g.remediation[0]).toContain("claude logout && claude login");
  });

  it("names Codex and gives the logout/login remediation", () => {
    const g = authFailureGuidance("codex");
    expect(g.provider).toBe("Codex");
    expect(g.headline).toContain("Codex");
    expect(g.headline).toContain("Invalid or expired credentials");
    expect(g.remediation.join(" ")).toContain("codex logout && codex login");
  });

  it("names Google and gives the API-key remediation", () => {
    const g = authFailureGuidance("google");
    expect(g.provider).toBe("Google");
    expect(g.headline).toContain("Google");
    const joined = g.remediation.join(" ");
    expect(joined).toContain("ndx config llm.google.api_key");
    expect(joined).toContain("GEMINI_API_KEY");
  });

  it("falls back to Claude for unknown/undefined vendors", () => {
    expect(authFailureGuidance(undefined).provider).toBe("Claude");
    expect(authFailureGuidance("mystery").provider).toBe("Claude");
  });

  it("never emits JSON-looking content in any field", () => {
    for (const vendor of ["claude", "codex", "google"]) {
      const g = authFailureGuidance(vendor);
      const all = [g.headline, ...g.remediation].join("\n");
      expect(all).not.toContain("{");
      expect(all).not.toContain("}");
    }
  });

  it("ends every vendor's remediation with the ndx auth verification step", () => {
    for (const vendor of ["claude", "codex", "google"]) {
      const g = authFailureGuidance(vendor);
      expect(g.remediation.at(-1)).toBe(VERIFY_CREDENTIALS_STEP);
    }
    expect(VERIFY_CREDENTIALS_STEP).toBe("Verify credentials: ndx auth");
  });
});

describe("authFailureMessage", () => {
  it("flattens to a single JSON-free line with headline + primary fix", () => {
    const m = authFailureMessage("claude");
    expect(m).toContain("Authentication failed for Claude");
    expect(m).toContain("Invalid or expired credentials");
    expect(m).toContain("claude logout && claude login");
    expect(m).not.toContain("\n");
    expect(m).not.toContain("{");
  });

  it("ends with the ndx auth verification step for every vendor", () => {
    for (const vendor of ["claude", "codex", "google"]) {
      expect(authFailureMessage(vendor)).toMatch(/Verify credentials: ndx auth\.$/);
    }
  });
});
