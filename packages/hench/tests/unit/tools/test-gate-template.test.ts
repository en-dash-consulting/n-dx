import { describe, it, expect } from "vitest";
import { applyGateTemplate, isGateBase, parseFailedSuites, parseSelectedSuites, planRerun } from "../../../src/tools/test-gate-template.js";

const SHA = "1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b";

describe("isGateBase", () => {
  it.each([["1a2b3c4"], [SHA]])("accepts %s", (v) => expect(isGateBase(v)).toBe(true));
  it.each([
    ["abc123"], // too short
    [`${SHA}0`], // too long
    ["1A2B3C4"], // upper case
    ["main"],
    ["1a2b3c4; rm -rf /"],
    ["1a2b3c4\n"],
    [""],
    [undefined],
    [42],
  ])("refuses %j", (v) => expect(isGateBase(v)).toBe(false));
});

describe("applyGateTemplate", () => {
  it("fills every {base}", () => {
    expect(applyGateTemplate("run {base} and {base}", SHA)).toEqual({
      ok: true,
      command: `run ${SHA} and ${SHA}`,
      base: SHA,
    });
  });

  it("uses a template without {base} as written, with no base recorded", () => {
    expect(applyGateTemplate("pnpm test", undefined)).toEqual({ ok: true, command: "pnpm test" });
    expect(applyGateTemplate("pnpm test", SHA)).toEqual({ ok: true, command: "pnpm test" });
  });

  it("refuses a {base} template when the base is unknown", () => {
    const result = applyGateTemplate("affected {base}", undefined);
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("unknown") });
  });

  it("refuses, and names, a base that is not a hex SHA", () => {
    const result = applyGateTemplate("affected {base}", "main; echo hi");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("main; echo hi");
  });
});

describe("parseSelectedSuites", () => {
  it("reads the comma list", () => {
    expect(parseSelectedSuites("noise\ntest-gate: selected-suites=hench,@n-dx/rex, web\nmore")).toEqual([
      "hench",
      "@n-dx/rex",
      "web",
    ]);
  });

  it("is undefined when the line is absent", () => {
    expect(parseSelectedSuites("PASS hench\nPASS rex")).toBeUndefined();
  });

  it("returns [] for an empty selection", () => {
    expect(parseSelectedSuites("test-gate: selected-suites=\n")).toEqual([]);
  });

  it("takes the last such line and tolerates CRLF", () => {
    expect(parseSelectedSuites("test-gate: selected-suites=a\r\ntest-gate: selected-suites=b\r\n")).toEqual(["b"]);
  });

  it("ignores the marker inside a longer line", () => {
    expect(parseSelectedSuites("echo test-gate: selected-suites=a")).toBeUndefined();
  });
});

describe("parseFailedSuites", () => {
  it("reads the last failed-suites line", () => {
    expect(parseFailedSuites("test-gate: failed-suites=a\nx\ntest-gate: failed-suites=rex, root\n")).toEqual(["rex", "root"]);
  });

  it("is undefined without the line and [] for an empty list", () => {
    expect(parseFailedSuites("FAIL x")).toBeUndefined();
    expect(parseFailedSuites("test-gate: failed-suites=")).toEqual([]);
  });
});

describe("planRerun", () => {
  const T = "node scripts/run-all-tests.mjs {suites}";

  it("fills {suites} with the failed labels, comma-joined", () => {
    expect(planRerun(T, "test-gate: failed-suites=rex,@n-dx/web,root")).toEqual({
      ok: true,
      command: "node scripts/run-all-tests.mjs rex,@n-dx/web,root",
      suites: ["rex", "@n-dx/web", "root"],
    });
  });

  it.each([
    ["no line", "FAIL x", /no failed suites/],
    ["an empty list", "test-gate: failed-suites=", /no failed suites/],
    ["a shell separator", "test-gate: failed-suites=rex,a;rm", /"a;rm" is not safe/],
    ["a substitution", "test-gate: failed-suites=rex,$(id)", /not safe/],
  ])("refuses %s", (_name, output, reason) => {
    const plan = planRerun(T, output);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(reason);
  });

  it("refuses a template without {suites}", () => {
    expect(planRerun("pnpm test", "test-gate: failed-suites=rex")).toEqual({
      ok: false,
      reason: "the template has no {suites}",
    });
  });
});
