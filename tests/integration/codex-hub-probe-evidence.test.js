import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  boundaryObserved, boundaryScript, checkDraftPhase, checkThread, probeCommand,
} from "../../packages/web/scripts/codex-hub-probe-evidence.mjs";

describe("host fixture evidence", () => {
  it.skipIf(process.platform === "win32")("does not classify a missing file as a denied read", () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-evidence-"));
    try {
      const run = spawnSync("/bin/sh", {
        input: boundaryScript([join(dir, "missing")], join(dir, "forbidden"), "marker"), encoding: "utf8",
      });
      expect(run.status).toBe(1);
      expect(run.stdout).toBe("marker\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("attributes observations only to the hosted probe command", () => {
    const output = "marker\nread0=denied\nread1=denied\nread2=denied\nwrite=denied\nHEADERS_HIDDEN\n";
    const result = { type: "tool_result", toolResult: { tool: "shell", isError: false, output } };
    const observe = (command) => boundaryObserved([
      { type: "tool_use", toolCall: { tool: "shell", input: { command } } }, result,
    ], "marker", false);
    expect(observe(`/bin/zsh -lc '${probeCommand}'`).readsDenied).toBe(true);
    expect(observe("echo markers").readsDenied).toBe(false);
  });

  it("requires the original vendor thread before and after recovery", () => {
    expect(() => checkThread("fresh", undefined, undefined, undefined)).toThrow();
    expect(() => checkThread("restart", "one", undefined, "one")).toThrow();
    expect(() => checkThread("resume", "one", "one", "two")).toThrow();
    expect(checkThread("after-stop", "one", "one", "one")).toBe("one");
  });

  it("requires exactly one matching draft card and its approved effect", () => {
    const input = { path: "approve.md", content: "DISPOSABLE_DRAFT", kind: "prompt" };
    const card = { tool: "save_draft", status: "approved", input, carriedOut: { ok: true } };
    expect(() => checkDraftPhase("approve", [card], input.path, input.content)).not.toThrow();
    expect(() => checkDraftPhase("approve", [card, card], input.path, input.content)).toThrow();
    expect(() => checkDraftPhase("approve", [card], input.path, "other content")).toThrow();
    expect(() => checkDraftPhase("deny", [], "deny.md", undefined)).toThrow();
  });
});
