import { describe, it, expect } from "vitest";
import {
  isModelCompatibleWithVendor,
  detectVendorChange,
  resetStaleModel,
  formatVendorChangeWarning,
} from "../../src/vendor-model-reset.js";

describe("vendor-model-reset", () => {
  describe("isModelCompatibleWithVendor", () => {
    describe("Claude vendor", () => {
      it("accepts claude-family models", () => {
        expect(isModelCompatibleWithVendor("claude", "claude-sonnet-4-6")).toBe(
          true,
        );
        expect(isModelCompatibleWithVendor("claude", "claude-opus-4-20250514")).toBe(
          true,
        );
        expect(isModelCompatibleWithVendor("claude", "claude-haiku-4-20250414")).toBe(
          true,
        );
      });

      it("accepts shorthand aliases that resolve to claude-", () => {
        expect(isModelCompatibleWithVendor("claude", "sonnet")).toBe(true);
        expect(isModelCompatibleWithVendor("claude", "opus")).toBe(true);
        expect(isModelCompatibleWithVendor("claude", "haiku")).toBe(true);
      });

      it("rejects gpt-family models", () => {
        expect(isModelCompatibleWithVendor("claude", "gpt-4o")).toBe(false);
        expect(isModelCompatibleWithVendor("claude", "gpt-5")).toBe(false);
      });

      it("rejects o-series models", () => {
        expect(isModelCompatibleWithVendor("claude", "o1")).toBe(false);
        expect(isModelCompatibleWithVendor("claude", "o3")).toBe(false);
      });

      it("rejects codex-branded models", () => {
        expect(isModelCompatibleWithVendor("claude", "codex")).toBe(false);
      });

      it("rejects empty/undefined models", () => {
        expect(isModelCompatibleWithVendor("claude", "")).toBe(false);
        expect(isModelCompatibleWithVendor("claude", undefined)).toBe(false);
        expect(isModelCompatibleWithVendor("claude", "   ")).toBe(false);
      });
    });

    describe("Codex vendor", () => {
      it("accepts gpt-family models", () => {
        expect(isModelCompatibleWithVendor("codex", "gpt-4o")).toBe(true);
        expect(isModelCompatibleWithVendor("codex", "gpt-5")).toBe(true);
        expect(isModelCompatibleWithVendor("codex", "gpt-4-turbo")).toBe(true);
      });

      it("accepts o-series models", () => {
        expect(isModelCompatibleWithVendor("codex", "o1")).toBe(true);
        expect(isModelCompatibleWithVendor("codex", "o1-preview")).toBe(true);
        expect(isModelCompatibleWithVendor("codex", "o3")).toBe(true);
      });

      it("accepts codex-branded models", () => {
        expect(isModelCompatibleWithVendor("codex", "codex")).toBe(true);
        expect(isModelCompatibleWithVendor("codex", "codex-002")).toBe(true);
      });

      it("rejects claude-family models", () => {
        expect(isModelCompatibleWithVendor("codex", "claude-sonnet-4-6")).toBe(
          false,
        );
        expect(isModelCompatibleWithVendor("codex", "sonnet")).toBe(false);
      });

      it("rejects empty/undefined models", () => {
        expect(isModelCompatibleWithVendor("codex", "")).toBe(false);
        expect(isModelCompatibleWithVendor("codex", undefined)).toBe(false);
        expect(isModelCompatibleWithVendor("codex", "   ")).toBe(false);
      });

      it("is case-insensitive for o-series", () => {
        expect(isModelCompatibleWithVendor("codex", "O1")).toBe(true);
        expect(isModelCompatibleWithVendor("codex", "O3")).toBe(true);
      });
    });
  });

  describe("detectVendorChange", () => {
    it("detects change from claude to codex", () => {
      expect(detectVendorChange("claude", "codex")).toBe(true);
    });

    it("detects change from codex to claude", () => {
      expect(detectVendorChange("codex", "claude")).toBe(true);
    });

    it("detects no change when vendor stays claude", () => {
      expect(detectVendorChange("claude", "claude")).toBe(false);
    });

    it("detects no change when vendor stays codex", () => {
      expect(detectVendorChange("codex", "codex")).toBe(false);
    });

    it("detects change from undefined to claude", () => {
      expect(detectVendorChange(undefined, "claude")).toBe(true);
    });

    it("detects change from undefined to codex", () => {
      expect(detectVendorChange(undefined, "codex")).toBe(true);
    });
  });

  describe("resetStaleModel", () => {
    describe("Claude to Codex transition", () => {
      it("clears claude model when switching to codex", () => {
        const result = resetStaleModel(
          "claude",
          "claude-sonnet-4-6",
          "codex",
        );
        expect(result.changed).toBe(true);
        expect(result.oldModel).toBe("claude-sonnet-4-6");
        expect(result.newModel).toBeUndefined();
        expect(result.reason).toBeDefined();
      });

      it("clears shorthand claude model when switching to codex", () => {
        const result = resetStaleModel("claude", "sonnet", "codex");
        expect(result.changed).toBe(true);
        expect(result.oldModel).toBe("sonnet");
        expect(result.newModel).toBeUndefined();
      });

      it("keeps gpt model when switching from claude to codex", () => {
        const result = resetStaleModel("claude", "gpt-4o", "codex");
        expect(result.changed).toBe(false);
        expect(result.oldModel).toBe("gpt-4o");
        expect(result.newModel).toBe("gpt-4o");
      });

      it("keeps o-series model when switching from claude to codex", () => {
        const result = resetStaleModel("claude", "o1", "codex");
        expect(result.changed).toBe(false);
        expect(result.oldModel).toBe("o1");
        expect(result.newModel).toBe("o1");
      });
    });

    describe("Codex to Claude transition", () => {
      it("clears gpt model when switching to claude", () => {
        const result = resetStaleModel("codex", "gpt-4o", "claude");
        expect(result.changed).toBe(true);
        expect(result.oldModel).toBe("gpt-4o");
        expect(result.newModel).toBeUndefined();
      });

      it("clears o-series model when switching to claude", () => {
        const result = resetStaleModel("codex", "o1", "claude");
        expect(result.changed).toBe(true);
        expect(result.oldModel).toBe("o1");
        expect(result.newModel).toBeUndefined();
      });

      it("clears codex-branded model when switching to claude", () => {
        const result = resetStaleModel("codex", "codex", "claude");
        expect(result.changed).toBe(true);
        expect(result.oldModel).toBe("codex");
        expect(result.newModel).toBeUndefined();
      });

      it("keeps claude model when switching from codex to claude", () => {
        const result = resetStaleModel("codex", "claude-sonnet-4-6", "claude");
        expect(result.changed).toBe(false);
        expect(result.oldModel).toBe("claude-sonnet-4-6");
        expect(result.newModel).toBe("claude-sonnet-4-6");
      });
    });

    describe("Vendor unchanged", () => {
      it("does not reset when vendor stays claude", () => {
        const result = resetStaleModel(
          "claude",
          "claude-sonnet-4-6",
          "claude",
        );
        expect(result.changed).toBe(false);
        expect(result.newModel).toBe("claude-sonnet-4-6");
        expect(result.reason).toBeUndefined();
      });

      it("does not reset when vendor stays codex", () => {
        const result = resetStaleModel("codex", "gpt-4o", "codex");
        expect(result.changed).toBe(false);
        expect(result.newModel).toBe("gpt-4o");
        expect(result.reason).toBeUndefined();
      });
    });

    describe("No previous vendor", () => {
      it("does not reset when setting vendor for first time", () => {
        const result = resetStaleModel(undefined, undefined, "claude");
        expect(result.changed).toBe(false);
        expect(result.newModel).toBeUndefined();
        expect(result.reason).toBeUndefined();
      });

      it("does not reset when changing from undefined to codex", () => {
        const result = resetStaleModel(undefined, undefined, "codex");
        expect(result.changed).toBe(false);
        expect(result.newModel).toBeUndefined();
        expect(result.reason).toBeUndefined();
      });
    });
  });

  describe("formatVendorChangeWarning", () => {
    it("formats warning when model was reset", () => {
      const result = resetStaleModel("claude", "claude-sonnet-4-6", "codex");
      const warning = formatVendorChangeWarning(result, "gpt-5");

      expect(warning).toBeDefined();
      expect(warning).toContain("claude");
      expect(warning).toContain("codex");
      expect(warning).toContain("claude-sonnet-4-6");
      expect(warning).toContain("gpt-5");
    });

    it("returns undefined when no reset occurred", () => {
      const result = resetStaleModel("claude", "claude-sonnet-4-6", "claude");
      const warning = formatVendorChangeWarning(result, "claude-sonnet-4-6");

      expect(warning).toBeUndefined();
    });

    it("formats warning without old model when vendor changed but no old model", () => {
      const result = resetStaleModel(undefined, undefined, "claude");
      // When vendor is undefined and model is undefined, no reset happens
      // So test with a scenario where there's vendor change but no model
      const manualResult = {
        changed: true,
        oldModel: undefined,
        newModel: undefined,
        reason: 'Vendor changed to "codex".',
      };
      const warning = formatVendorChangeWarning(manualResult, "gpt-5");

      expect(warning).toBeDefined();
      expect(warning).toContain("codex");
      expect(warning).toContain("gpt-5");
      expect(warning).not.toContain("Old model:");
    });

    it("handles result with reason but no old model", () => {
      const result = {
        changed: true,
        oldModel: undefined,
        newModel: undefined,
        reason: 'Vendor changed to "codex".',
      };
      const warning = formatVendorChangeWarning(result, "gpt-5");

      expect(warning).toBeDefined();
      expect(warning?.includes("New default: gpt-5")).toBe(true);
    });
  });
});
