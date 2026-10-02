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

describe("run options: values the command line must never carry", () => {
  const flagStrings = RUN_OPTION_SPECS.filter((s) => s.type === "string" && s.via !== "file");
  const optionsFor = (key: string, value: unknown) =>
    key === "reviewModel" ? { review: true, reviewModel: value } : { [key]: value };

  it.each([
    ["a space", "a b"],
    ["a tab", "a\tb"],
    ["a newline", "a\nb"],
    ["a carriage return", "a\rb"],
    ["a NUL", "a\u0000b"],
    ["an escape", "a\u001bb"],
    ["DEL", "a\u007fb"],
    ["a C1 control", "a\u0085b"],
    ["a line separator", "a b"],
    ["nothing", ""],
  ])("refuses %s in every flag-valued string", (_name, value) => {
    for (const spec of flagStrings) {
      expect(checkRunOptions(optionsFor(spec.key, value)), spec.key).toMatchObject({ ok: false, key: spec.key });
    }
  });

  it("accepts an ordinary model id in every flag-valued string", () => {
    for (const spec of flagStrings) {
      expect(checkRunOptions(optionsFor(spec.key, "claude-sonnet-4.5")), spec.key).toMatchObject({ ok: true });
    }
  });

  it("lets contextNotes carry newlines and a leading '-', since its text goes to a file", () => {
    expect(checkRunOptions({ contextNotes: "- a\n\tb" })).toMatchObject({ ok: true });
  });

  it.each(["__proto__", "constructor", "prototype", "toString", "hasOwnProperty"])(
    "refuses %s as a key",
    (key) => {
      // JSON.parse makes "__proto__" an own property; an object literal would set the prototype.
      const parsed = JSON.parse(`{"${key}": {"model": "m"}}`);
      expect(checkRunOptions(parsed)).toMatchObject({ ok: false, key });
    },
  );

  it("does not let a __proto__ key pollute anything", () => {
    const result = checkRunOptions(JSON.parse('{"model": "m", "__proto__": {"review": true}}'));
    expect(result).toMatchObject({ ok: false, key: "__proto__" });
    expect(({} as Record<string, unknown>).review).toBeUndefined();
  });

  it.each([
    ["maxTurns", "40"],
    ["tokenBudget", "1000"],
    ["review", "true"],
    ["fresh", "false"],
    ["allowDirty", 1],
    ["skipTestGate", "yes"],
    ["maxTurns", null],
    ["model", 5],
    ["provider", ["cli"]],
  ])("refuses %s given as %j", (key, value) => {
    expect(checkRunOptions({ [key]: value })).toMatchObject({ ok: false, key });
  });

  it("refuses non-object options", () => {
    for (const bad of [null, "x", 3, true, []]) {
      expect(checkRunOptions(bad)).toMatchObject({ ok: false, key: "options" });
    }
  });

  it("refuses an unknown key even beside valid ones", () => {
    expect(checkRunOptions({ model: "m", extra: 1 })).toMatchObject({ ok: false, key: "extra" });
  });
});

describe("run options: integer bounds", () => {
  const integers = RUN_OPTION_SPECS.filter((s) => s.type === "integer");

  it("covers maxTurns 1..500 and tokenBudget 0..MAX_SAFE_INTEGER", () => {
    expect(integers.map((s) => [s.key, s.min, s.max])).toEqual([
      ["maxTurns", 1, 500],
      ["tokenBudget", 0, Number.MAX_SAFE_INTEGER],
    ]);
  });

  it("accepts each bound and refuses one past it", () => {
    for (const spec of integers) {
      expect(checkRunOptions({ [spec.key]: spec.min }), `${spec.key} min`).toMatchObject({ ok: true });
      expect(checkRunOptions({ [spec.key]: spec.max }), `${spec.key} max`).toMatchObject({ ok: true });
      expect(checkRunOptions({ [spec.key]: spec.min! - 1 }), `${spec.key} below`).toMatchObject({ ok: false, key: spec.key });
      expect(checkRunOptions({ [spec.key]: spec.max! + 1 }), `${spec.key} above`).toMatchObject({ ok: false, key: spec.key });
    }
  });

  it.each([1.5, NaN, Infinity, -Infinity, 1e21])("refuses %s", (value) => {
    for (const spec of integers) {
      expect(checkRunOptions({ [spec.key]: value }), spec.key).toMatchObject({ ok: false, key: spec.key });
    }
  });
});
