import { describe, it, expect } from "vitest";
import {
  mapSandboxToCodexFlag,
  mapApprovalToCodexFlag,
  compileCodexPolicyFlags,
} from "../../src/codex-cli-provider.js";
import { DEFAULT_EXECUTION_POLICY } from "../../src/runtime-contract.js";
import type { ExecutionPolicy, SandboxMode, ApprovalPolicy } from "../../src/runtime-contract.js";

describe("Codex policy flag compilation", () => {
  describe("mapSandboxToCodexFlag", () => {
    it("maps read-only to read-only", () => {
      expect(mapSandboxToCodexFlag("read-only")).toBe("read-only");
    });

    it("maps workspace-write to workspace-write", () => {
      expect(mapSandboxToCodexFlag("workspace-write")).toBe("workspace-write");
    });

    it("maps danger-full-access to full-access", () => {
      expect(mapSandboxToCodexFlag("danger-full-access")).toBe("full-access");
    });

    it("covers all SandboxMode values", () => {
      const modes: SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];
      for (const mode of modes) {
        expect(typeof mapSandboxToCodexFlag(mode)).toBe("string");
      }
    });
  });

  describe("mapApprovalToCodexFlag", () => {
    it("maps on-request to auto-edit", () => {
      expect(mapApprovalToCodexFlag("on-request")).toBe("auto-edit");
    });

    it("maps never to full-auto", () => {
      expect(mapApprovalToCodexFlag("never")).toBe("full-auto");
    });

    it("covers all ApprovalPolicy values", () => {
      const policies: ApprovalPolicy[] = ["on-request", "never"];
      for (const policy of policies) {
        expect(typeof mapApprovalToCodexFlag(policy)).toBe("string");
      }
    });
  });

  describe("compileCodexPolicyFlags", () => {
    it("produces explicit --sandbox and --approval-policy flags", () => {
      const flags = compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY);
      expect(flags).toEqual([
        "--sandbox",
        "workspace-write",
        "--approval-policy",
        "full-auto",
      ]);
    });

    it("compiles read-only + on-request policy", () => {
      const policy: ExecutionPolicy = {
        ...DEFAULT_EXECUTION_POLICY,
        sandbox: "read-only",
        approvals: "on-request",
      };
      const flags = compileCodexPolicyFlags(policy);
      expect(flags).toEqual([
        "--sandbox",
        "read-only",
        "--approval-policy",
        "auto-edit",
      ]);
    });

    it("compiles danger-full-access + never policy", () => {
      const policy: ExecutionPolicy = {
        ...DEFAULT_EXECUTION_POLICY,
        sandbox: "danger-full-access",
        approvals: "never",
      };
      const flags = compileCodexPolicyFlags(policy);
      expect(flags).toEqual([
        "--sandbox",
        "full-access",
        "--approval-policy",
        "full-auto",
      ]);
    });

    it("does not include --full-auto as a standalone flag", () => {
      const flags = compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY);
      // --full-auto should not appear as a standalone flag —
      // it should only appear as the value of --approval-policy
      expect(flags.indexOf("--full-auto")).toBe(-1);
    });

    it("returns exactly 4 elements (two flag-value pairs)", () => {
      const flags = compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY);
      expect(flags).toHaveLength(4);
    });
  });
});
