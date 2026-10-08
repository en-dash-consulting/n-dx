import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CLI_NAME, readCliName } from "../../../src/server/cli-name.js";

describe("readCliName", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "web-cli-name-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults when no project config exists, or cli.name is absent or malformed", () => {
    expect(readCliName(dir)).toBe(DEFAULT_CLI_NAME);
    writeFileSync(join(dir, ".n-dx.json"), JSON.stringify({ cli: { name: 42 } }));
    expect(readCliName(dir)).toBe(DEFAULT_CLI_NAME);
    writeFileSync(join(dir, ".n-dx.json"), "{not json");
    expect(readCliName(dir)).toBe(DEFAULT_CLI_NAME);
  });

  it("reads cli.name from .n-dx.json on the legacy layout", () => {
    writeFileSync(join(dir, ".n-dx.json"), JSON.stringify({ cli: { name: "myapp" } }));
    expect(readCliName(dir)).toBe("myapp");
  });

  it("reads cli.name from .ndx/config.json on the .ndx/ layout, not from a root .n-dx.json", () => {
    mkdirSync(join(dir, ".ndx"));
    writeFileSync(join(dir, ".ndx", "config.json"), JSON.stringify({ cli: { name: "ndxapp" } }));
    writeFileSync(join(dir, ".n-dx.json"), JSON.stringify({ cli: { name: "legacy" } }));
    expect(readCliName(dir)).toBe("ndxapp");
  });
});
