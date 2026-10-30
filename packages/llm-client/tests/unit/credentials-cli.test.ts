/**
 * The credential store's spawnable entry, driven in process.
 *
 * The rule under test besides the commands themselves: no output, on stdout
 * or stderr, ever contains the value — not on success, and not when the value
 * was wrongly passed on argv.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCredentialsCli } from "../../src/cli/credentials.js";
import { credentialFingerprint, resolveCredential } from "../../src/credential-store.js";

const VALUE = "placeholder-cli-key";

let home: string;
let out: string;
let err: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ndx-cred-cli-"));
  out = "";
  err = "";
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function run(argv: string[], stdin: string | null = null, env: Record<string, string> = {}): Promise<number> {
  return runCredentialsCli(argv, {
    readStdin: async () => stdin,
    stdout: (t) => { out += t; },
    stderr: (t) => { err += t; },
    store: { ndxHome: home, env },
  });
}

const stored = () => resolveCredential("typesafe", { ndxHome: home, env: {} });

describe("set", () => {
  it("stores the value read from stdin, trailing newline dropped, and does not print it", async () => {
    expect(await run(["set", "typesafe"], `${VALUE}\n`)).toBe(0);
    expect(stored()).toEqual({ value: VALUE, source: "file" });
    expect(out).toBe("Stored typesafe.\n");
    expect(out + err).not.toContain(VALUE);
  });

  it("refuses a value on argv without echoing it", async () => {
    expect(await run(["set", "typesafe", VALUE], "ignored")).toBe(2);
    expect(err).toMatch(/refused/);
    expect(out + err).not.toContain(VALUE);
    expect(stored()).toBeUndefined();
  });

  it("refuses when stdin is a terminal or empty", async () => {
    expect(await run(["set", "typesafe"], null)).toBe(2);
    expect(await run(["set", "typesafe"], "  \n")).toBe(1);
    expect(stored()).toBeUndefined();
  });

  it.each([["openai"], ["connection:x"], ["Typesafe"]])("accepts only typesafe, not %s", async (name) => {
    expect(await run(["set", name], VALUE)).toBe(2);
    expect(err).toMatch(/Unknown credential name/);
    expect(out + err).not.toContain(VALUE);
  });

  it("reports a store error without the value", async () => {
    expect(await run(["set", "typesafe"], "a\nb\n")).toBe(1);
    expect(err).toMatch(/multi-line/);
    expect(err).not.toContain("a\nb");
  });
});

describe("unset", () => {
  it("removes a stored credential and says when there was none", async () => {
    await run(["set", "typesafe"], VALUE);
    out = "";
    expect(await run(["unset", "typesafe"])).toBe(0);
    expect(out).toBe("Removed typesafe.\n");
    expect(stored()).toBeUndefined();
    out = "";
    expect(await run(["unset", "typesafe"])).toBe(0);
    expect(out).toBe("typesafe was not stored.\n");
  });

  it("refuses an unknown name", async () => {
    expect(await run(["unset", "openai"])).toBe(2);
  });
});

describe("status", () => {
  it("prints source and fingerprint, never the value", async () => {
    await run(["set", "typesafe"], VALUE);
    out = "";
    expect(await run(["status"])).toBe(0);
    expect(out).toContain(`typesafe: credential store (file), fingerprint ${credentialFingerprint(VALUE)}`);
    expect(out).toContain(join(home, "credentials.json"));
    expect(out).not.toContain(VALUE);
  });

  it("--json lists each name with source, backend and fingerprint", async () => {
    await run(["set", "typesafe"], VALUE);
    out = "";
    expect(await run(["status", "--json"], null, { TYPESAFE_API_KEY: "placeholder-env-key" })).toBe(0);
    expect(JSON.parse(out)).toEqual([{
      name: "typesafe",
      source: "env",
      backend: "file",
      fingerprint: credentialFingerprint("placeholder-env-key"),
      envVar: "TYPESAFE_API_KEY",
      storePath: join(home, "credentials.json"),
    }]);
    expect(out).not.toContain(VALUE);
    expect(out).not.toContain("placeholder-env-key");
  });

  it("says not set when nothing is", async () => {
    expect(await run(["status"])).toBe(0);
    expect(out).toContain("typesafe: not set");
  });
});

describe("usage", () => {
  it("exits 2 on an unknown command or none", async () => {
    expect(await run(["get", "typesafe"])).toBe(2);
    expect(await run([])).toBe(2);
    expect(await run(["--help"])).toBe(0);
  });
});
