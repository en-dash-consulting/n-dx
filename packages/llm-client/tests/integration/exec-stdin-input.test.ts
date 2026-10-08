/**
 * `exec`'s `input` option writes to a real child's stdin.
 */

import { describe, it, expect } from "vitest";
import { exec } from "../../src/exec.js";

const node = process.execPath;
const opts = { cwd: process.cwd(), timeout: 30_000 };

describe("exec input", () => {
  it("writes input to the child's stdin and closes it", async () => {
    const script = "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(s.toUpperCase()))";
    const result = await exec(node, ["-e", script], { ...opts, input: "hello\nworld\n" });
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();
    expect(result.stdout).toBe("HELLO\nWORLD\n");
  });

  it("reports the child's own exit status when it exits without reading the input", async () => {
    const result = await exec(node, ["-e", "process.exit(3)"], { ...opts, input: "x".repeat(8 * 1024 * 1024) });
    expect(result.exitCode).toBe(3);
    expect(result.launched).toBe(true);
  });

  it("closes stdin at once without input, so a reader sees end of input", async () => {
    const script = "let n=0;process.stdin.on('data',d=>n+=d.length).on('end',()=>process.stdout.write(String(n)))";
    const result = await exec(node, ["-e", script], opts);
    expect(result.stdout).toBe("0");
  });
});
