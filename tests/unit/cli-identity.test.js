import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveCliName,
  detectCliName,
  recordCliName,
  DEFAULT_CLI_NAME,
} from "../../packages/core/cli-identity.js";

describe("resolveCliName", () => {
  it("returns the first binary name from a bin object", () => {
    expect(resolveCliName({ name: "my-tool", bin: { myapp: "./cli.js", other: "./other.js" } })).toBe("myapp");
  });

  it("returns the package name for a bin string (npm semantics)", () => {
    expect(resolveCliName({ name: "myapp", bin: "./cli.js" })).toBe("myapp");
  });

  it("strips the scope from a scoped package name for a bin string", () => {
    expect(resolveCliName({ name: "@acme/myapp", bin: "./cli.js" })).toBe("myapp");
  });

  it("defaults to 'ndx' when package.json has no bin field", () => {
    expect(resolveCliName({ name: "myapp" })).toBe("ndx");
    expect(DEFAULT_CLI_NAME).toBe("ndx");
  });

  it("defaults to 'ndx' for empty or invalid bin values", () => {
    expect(resolveCliName({ name: "myapp", bin: {} })).toBe("ndx");
    expect(resolveCliName({ name: "myapp", bin: 42 })).toBe("ndx");
    expect(resolveCliName({ bin: "./cli.js" })).toBe("ndx"); // bin string but no name
    expect(resolveCliName(null)).toBe("ndx");
    expect(resolveCliName(undefined)).toBe("ndx");
  });
});

describe("detectCliName / recordCliName", () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cli-identity-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("detectCliName reads bin from package.json at the project root", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", bin: { myapp: "./cli.js" } }));
    expect(detectCliName(dir)).toBe("myapp");
  });

  it("detectCliName defaults to 'ndx' when package.json is missing", () => {
    expect(detectCliName(dir)).toBe("ndx");
  });

  it("detectCliName defaults to 'ndx' when package.json is malformed", () => {
    writeFileSync(join(dir, "package.json"), "{not json");
    expect(detectCliName(dir)).toBe("ndx");
  });

  it("recordCliName writes the detected name as cli.name in .n-dx.json", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", bin: { myapp: "./cli.js" } }));
    recordCliName(dir);
    const config = JSON.parse(readFileSync(join(dir, ".n-dx.json"), "utf-8"));
    expect(config.cli.name).toBe("myapp");
  });

  it("recordCliName merges into an existing .n-dx.json without dropping other keys", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", bin: { myapp: "./cli.js" } }));
    writeFileSync(join(dir, ".n-dx.json"), JSON.stringify({ cli: { timeoutMs: 5000 }, web: { port: 4000 } }));
    recordCliName(dir);
    const config = JSON.parse(readFileSync(join(dir, ".n-dx.json"), "utf-8"));
    expect(config.cli.name).toBe("myapp");
    expect(config.cli.timeoutMs).toBe(5000);
    expect(config.web.port).toBe(4000);
  });

  it("recordCliName preserves a manual override already present in .n-dx.json", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", bin: { myapp: "./cli.js" } }));
    writeFileSync(join(dir, ".n-dx.json"), JSON.stringify({ cli: { name: "customcli" } }));
    recordCliName(dir);
    const config = JSON.parse(readFileSync(join(dir, ".n-dx.json"), "utf-8"));
    expect(config.cli.name).toBe("customcli");
  });

  it("recordCliName writes the default 'ndx' when no bin field exists", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    recordCliName(dir);
    const config = JSON.parse(readFileSync(join(dir, ".n-dx.json"), "utf-8"));
    expect(config.cli.name).toBe("ndx");
  });

  it("recordCliName is best-effort and does not throw on an unwritable dir", () => {
    expect(() => recordCliName(join(dir, "does-not-exist"))).not.toThrow();
    expect(existsSync(join(dir, "does-not-exist", ".n-dx.json"))).toBe(false);
  });
});
