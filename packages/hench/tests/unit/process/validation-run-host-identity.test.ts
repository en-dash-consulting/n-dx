import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInValidationSlot } from "../../../src/process/validation-run.js";
import { VALIDATION_SLOT_ENV } from "../../../src/process/validation-slot.js";
import { runTestGate } from "../../../src/tools/test-runner.js";

// A transient machine-id lookup failure while resolving the slot directory.
vi.mock("../../../src/process/validation-slot-dir.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/process/validation-slot-dir.js")>();
  return {
    ...actual,
    resolveValidationSlotDir: async () => {
      throw new actual.HostIdentityLookupError(
        "running ioreg -rd1 -c IOPlatformExpertDevice",
        "Command timed out after 10000ms",
      );
    },
  };
});

const LOOKUP_WARNING =
  /skipped the validation slot and ran without it: .*could not read this host's machine id \(running ioreg -rd1 -c IOPlatformExpertDevice: Command timed out after 10000ms\)/;

describe("a transient machine-id lookup failure", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-slot-identity-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("runs the command without the slot and names the lookup in slotWarning", async () => {
    const run = await runInValidationSlot({ projectDir }, async (withSlot) => withSlot({ env: {} }).env);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value[VALIDATION_SLOT_ENV]).toBeUndefined();
    expect(run.timing).toBeUndefined();
    expect(run.slotWarning).toMatch(LOOKUP_WARNING);
  });

  it("lets the test gate run its command unslotted and warn", async () => {
    const warnings: string[] = [];
    const result = await runTestGate({
      projectDir,
      filesChanged: ["src/a.ts"],
      testCommand: `node -e "require('fs').writeFileSync('ran', '')"`,
      validationSlot: { projectDir, onWarning: (w) => warnings.push(w) },
    });
    expect(result.ran).toBe(true);
    expect(result.passed).toBe(true);
    expect(existsSync(join(projectDir, "ran"))).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(LOOKUP_WARNING);
  });
});
