import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { CLIError } from "../../../../src/cli/errors.js";
import { cmdUpdate } from "../../../../src/cli/commands/update.js";

describe("cmdUpdate", () => {
  let tmp: string;
  const itemId = "test-item-123";

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-update-test-"));
    mkdirSync(join(tmp, ".rex"));
    writeFileSync(
      join(tmp, ".rex", "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        title: "test",
        items: [
          {
            id: itemId,
            title: "Test item",
            level: "epic",
            status: "pending",
          },
        ],
      }),
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true });
  });

  it("throws CLIError when ID is missing", async () => {
    await expect(cmdUpdate(tmp, "", {})).rejects.toThrow(CLIError);
    await expect(cmdUpdate(tmp, "", {})).rejects.toThrow(/Missing item ID/);
  });

  it("includes usage hint when ID is missing", async () => {
    try {
      await cmdUpdate(tmp, "", {});
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).suggestion).toContain("rex update");
    }
  });

  it("throws CLIError when item not found", async () => {
    await expect(cmdUpdate(tmp, "nonexistent", { status: "completed" })).rejects.toThrow(CLIError);
    await expect(cmdUpdate(tmp, "nonexistent", { status: "completed" })).rejects.toThrow(
      /not found/,
    );
  });

  it("includes suggestion to check status when item not found", async () => {
    try {
      await cmdUpdate(tmp, "nonexistent", { status: "completed" });
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).suggestion).toContain("rex status");
    }
  });

  it("throws CLIError for invalid status", async () => {
    await expect(cmdUpdate(tmp, itemId, { status: "invalid" })).rejects.toThrow(CLIError);
    await expect(cmdUpdate(tmp, itemId, { status: "invalid" })).rejects.toThrow(/Invalid status/);
  });

  it("includes valid statuses in suggestion", async () => {
    try {
      await cmdUpdate(tmp, itemId, { status: "invalid" });
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).suggestion).toContain("pending");
      expect((err as CLIError).suggestion).toContain("completed");
    }
  });

  it("throws CLIError for invalid priority", async () => {
    await expect(cmdUpdate(tmp, itemId, { priority: "invalid" })).rejects.toThrow(CLIError);
    await expect(cmdUpdate(tmp, itemId, { priority: "invalid" })).rejects.toThrow(
      /Invalid priority/,
    );
  });

  it("includes valid priorities in suggestion", async () => {
    try {
      await cmdUpdate(tmp, itemId, { priority: "invalid" });
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).suggestion).toContain("high");
      expect((err as CLIError).suggestion).toContain("low");
    }
  });

  it("throws CLIError when no updates are specified", async () => {
    await expect(cmdUpdate(tmp, itemId, {})).rejects.toThrow(CLIError);
    await expect(cmdUpdate(tmp, itemId, {})).rejects.toThrow(/No updates specified/);
  });

  it("includes available flags in suggestion for no updates", async () => {
    try {
      await cmdUpdate(tmp, itemId, {});
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).suggestion).toContain("--status");
      expect((err as CLIError).suggestion).toContain("--priority");
    }
  });

  it("throws CLIError when .rex directory does not exist", async () => {
    const noRexDir = mkdtempSync(join(tmpdir(), "rex-update-norex-"));
    try {
      await expect(
        cmdUpdate(noRexDir, itemId, { status: "completed" }),
      ).rejects.toThrow(CLIError);
      await expect(
        cmdUpdate(noRexDir, itemId, { status: "completed" }),
      ).rejects.toThrow(/Rex directory not found/);
    } finally {
      rmSync(noRexDir, { recursive: true });
    }
  });

  it("succeeds for valid update", async () => {
    await expect(
      cmdUpdate(tmp, itemId, { status: "completed" }),
    ).resolves.toBeUndefined();
  });

  it("accepts blocked as a valid status", async () => {
    await expect(
      cmdUpdate(tmp, itemId, { status: "blocked" }),
    ).resolves.toBeUndefined();
  });
});
