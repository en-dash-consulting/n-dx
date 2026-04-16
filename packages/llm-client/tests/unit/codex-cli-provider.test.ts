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

    it("maps danger-full-access to danger-full-access", () => {
      expect(mapSandboxToCodexFlag("danger-full-access")).toBe("danger-full-access");
    });

    it("covers all SandboxMode values", () => {
      const modes: SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];
      for (const mode of modes) {
        expect(typeof mapSandboxToCodexFlag(mode)).toBe("string");
      }
    });
  });

  describe("mapApprovalToCodexFlag", () => {
    it("maps on-request to default", () => {
      expect(mapApprovalToCodexFlag("on-request")).toBe("default");
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
    it("uses --full-auto for the default unattended policy", () => {
      const flags = compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY);
      expect(flags).toEqual(["--full-auto"]);
    });

    it("compiles read-only + on-request policy to a plain sandbox flag", () => {
      const policy: ExecutionPolicy = {
        ...DEFAULT_EXECUTION_POLICY,
        sandbox: "read-only",
        approvals: "on-request",
      };
      const flags = compileCodexPolicyFlags(policy);
      expect(flags).toEqual(["--sandbox", "read-only"]);
    });

    it("compiles workspace-write + on-request policy to a plain sandbox flag", () => {
      const policy: ExecutionPolicy = {
        ...DEFAULT_EXECUTION_POLICY,
        approvals: "on-request",
      };
      const flags = compileCodexPolicyFlags(policy);
      expect(flags).toEqual(["--sandbox", "workspace-write"]);
    });

    it("compiles danger-full-access + never policy", () => {
      const policy: ExecutionPolicy = {
        ...DEFAULT_EXECUTION_POLICY,
        sandbox: "danger-full-access",
        approvals: "never",
      };
      const flags = compileCodexPolicyFlags(policy);
      expect(flags).toEqual(["--dangerously-bypass-approvals-and-sandbox"]);
    });

    it("compiles danger-full-access + on-request to an explicit sandbox flag", () => {
      const policy: ExecutionPolicy = {
        ...DEFAULT_EXECUTION_POLICY,
        sandbox: "danger-full-access",
        approvals: "on-request",
      };
      const flags = compileCodexPolicyFlags(policy);
      expect(flags).toEqual(["--sandbox", "danger-full-access"]);
    });

    it("returns a compact supported flag set", () => {
      expect(compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY)).toHaveLength(1);
      expect(
        compileCodexPolicyFlags({
          ...DEFAULT_EXECUTION_POLICY,
          approvals: "on-request",
        }),
      ).toHaveLength(2);
    });
  });
});
