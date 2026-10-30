import { describe, it, expect } from "vitest";
import { parseYamlSubset } from "../../src/yaml-subset.js";

describe("CI YAML adversarial regressions", () => {
  it("preserves block-script comments, blank lines and tag-like shell text", () => {
    expect(parseYamlSubset('run: |\n  # shell comment\n  echo !!done\n\n  echo &worker\nnext: ok\n')).toEqual({
      run: "# shell comment\necho !!done\n\necho &worker", next: "ok",
    });
  });
  it("treats tag-like text inside quoted or plain shell scalars as text", () => {
    expect(parseYamlSubset('run: "echo !!done"')).toEqual({ run: "echo !!done" });
    expect(parseYamlSubset('run: echo !!done')).toEqual({ run: "echo !!done" });
  });
  it("parses nested flow collections instead of silently returning strings", () => {
    expect(parseYamlSubset("steps: [{run: npm test}, {run: {command: npm run deploy}}]")).toEqual({
      steps: [{ run: "npm test" }, { run: { command: "npm run deploy" } }],
    });
  });
});
