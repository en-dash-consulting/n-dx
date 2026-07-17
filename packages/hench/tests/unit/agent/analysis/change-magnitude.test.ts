import { describe, it, expect, vi } from "vitest";
import {
  measureChangeMagnitude,
  sumNumstatLines,
} from "../../../../src/agent/analysis/change-magnitude.js";

/** Build an exec stub returning canned output per git subcommand. */
function makeExec(outputs: { status?: string; numstat?: string; failStatus?: boolean; failNumstat?: boolean }) {
  return vi.fn(async (_cmd: string, args: string[]) => {
    if (args[0] === "status") {
      if (outputs.failStatus) throw new Error("not a git repo");
      return outputs.status ?? "";
    }
    if (args[0] === "diff") {
      if (outputs.failNumstat) throw new Error("no HEAD");
      return outputs.numstat ?? "";
    }
    throw new Error(`unexpected git args: ${args.join(" ")}`);
  });
}

describe("sumNumstatLines", () => {
  it("sums insertions and deletions across lines", () => {
    expect(sumNumstatLines("10\t5\tsrc/a.ts\n3\t0\tsrc/b.ts\n")).toBe(18);
  });

  it("skips binary file markers ('-')", () => {
    expect(sumNumstatLines("-\t-\tassets/logo.png\n7\t2\tsrc/a.ts")).toBe(9);
  });

  it("returns 0 for empty output", () => {
    expect(sumNumstatLines("")).toBe(0);
    expect(sumNumstatLines("\n")).toBe(0);
  });
});

describe("measureChangeMagnitude", () => {
  it("counts dirty files and changed lines", async () => {
    const exec = makeExec({
      status: " M src/a.ts\n?? new-file.ts\n",
      numstat: "12\t4\tsrc/a.ts\n",
    });
    expect(await measureChangeMagnitude("/repo", exec)).toEqual({ files: 2, linesChanged: 16 });
  });

  it("reports zeros for a clean tree", async () => {
    const exec = makeExec({ status: "", numstat: "" });
    expect(await measureChangeMagnitude("/repo", exec)).toEqual({ files: 0, linesChanged: 0 });
  });

  it("degrades linesChanged to 0 when diff fails (fresh repo with no HEAD)", async () => {
    const exec = makeExec({ status: "?? a.ts\n?? b.ts", failNumstat: true });
    expect(await measureChangeMagnitude("/repo", exec)).toEqual({ files: 2, linesChanged: 0 });
  });

  it("degrades to all zeros when git is unavailable", async () => {
    const exec = makeExec({ failStatus: true, failNumstat: true });
    expect(await measureChangeMagnitude("/repo", exec)).toEqual({ files: 0, linesChanged: 0 });
  });
});
