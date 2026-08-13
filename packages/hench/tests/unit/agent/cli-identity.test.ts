import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProjectCliName } from "../../../src/agent/planning/cli-identity.js";

describe("resolveProjectCliName", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hench-cli-identity-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads cli.name from .n-dx.json", () => {
    writeFileSync(join(dir, ".n-dx.json"), JSON.stringify({ cli: { name: "myapp" } }));
    expect(resolveProjectCliName(dir)).toBe("myapp");
  });

  it("defaults to 'n-dx' when .n-dx.json is missing", () => {
    expect(resolveProjectCliName(dir)).toBe("n-dx");
  });

  it("defaults to 'n-dx' when cli.name is absent or not a string", () => {
    writeFileSync(join(dir, ".n-dx.json"), JSON.stringify({ cli: { timeoutMs: 5 } }));
    expect(resolveProjectCliName(dir)).toBe("n-dx");
    writeFileSync(join(dir, ".n-dx.json"), JSON.stringify({ cli: { name: 42 } }));
    expect(resolveProjectCliName(dir)).toBe("n-dx");
  });

  it("defaults to 'n-dx' when .n-dx.json is malformed", () => {
    writeFileSync(join(dir, ".n-dx.json"), "{not json");
    expect(resolveProjectCliName(dir)).toBe("n-dx");
  });
});
