import { describe, it, expect } from "vitest";
import { RUN_OPTION_SPECS, checkRunOptions, runOptionArgs } from "../../../src/shared/index.js";

describe("run options", () => {
  it("treats absent options as none", () => {
    expect(checkRunOptions(undefined)).toEqual({ ok: true, options: {} });
    expect(runOptionArgs({})).toEqual([]);
  });

  it("refuses a leading '-' in every option whose value reaches the command line", () => {
    for (const spec of RUN_OPTION_SPECS.filter((s) => s.type === "string" && s.via !== "file")) {
      const input = spec.key === "reviewModel" ? { review: true, reviewModel: "-x" } : { [spec.key]: "-x" };
      expect(checkRunOptions(input)).toMatchObject({ ok: false, key: spec.key });
    }
  });

  it("writes every flag as one --flag or --flag=value word", () => {
    const args = runOptionArgs(
      { model: "m", maxTurns: 3, review: true, reviewModel: "r", contextNotes: "notes" },
      "/tmp/ctx.md",
    );
    expect(args).toEqual(["--model=m", "--review", "--review-model=r", "--max-turns=3", "--context-file=/tmp/ctx.md"]);
    for (const arg of args) expect(arg).toMatch(/^--[a-z-]+(=\S+)?$/);
  });

  it("leaves contextNotes off the command line until the server has written its file", () => {
    expect(runOptionArgs({ contextNotes: "notes" })).toEqual([]);
  });
});
