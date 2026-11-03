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

describe("set-helper", () => {
  it("stores the argv read from stdin as JSON and names argv[0]", async () => {
    expect(await run(["set-helper", "typesafe"], JSON.stringify(["pass", "show", "ndx/typesafe"]))).toBe(0);
    expect(out).toBe("Stored typesafe: helper (pass).\n");
    expect(resolveCredential("typesafe", { ndxHome: home, env: {}, runHelpers: false })).toBeUndefined();
  });

  it.each([
    ["not JSON", "op read x", /not valid JSON/],
    ["not an array", JSON.stringify({ argv: ["op"] }), /non-empty argv array/],
    ["empty", "[]", /non-empty argv array/],
    ["a leading dash", JSON.stringify(["-c", "x"]), /start with "-"/],
  ])("refuses %s as a usage error", async (_label, stdin, message) => {
    expect(await run(["set-helper", "typesafe"], stdin)).toBe(2);
    expect(err).toMatch(message);
  });

  it.each([
    [["bash", "-c", "op read x"]],
    [["node", "-e", "1"]],
    [["python3", "-c", "print(1)"]],
    [["node"]],
  ])("refuses the interpreter helper %j, which has no script, and stores nothing", async (argv) => {
    expect(await run(["set-helper", "typesafe"], JSON.stringify(argv))).toBe(2);
    expect(err).toMatch(/is a shell, not a helper/);
    expect(resolveCredential("typesafe", { ndxHome: home, env: {}, runHelpers: false })).toBeUndefined();
  });

  it("stores an interpreter helper with a script and says the interpreter stays allowed", async () => {
    expect(await run(["set-helper", "typesafe"], JSON.stringify(["node", "/x/get-key.mjs", "--vault"]))).toBe(0);
    expect(out).toBe(
      "Stored typesafe: helper (node).\n" +
        'Note: agents can still run node itself; only "node /x/get-key.mjs" is denied to them.\n',
    );
  });

  it("refuses an argv on the command line", async () => {
    expect(await run(["set-helper", "typesafe", "op"], "[\"op\"]")).toBe(2);
  });
});

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
    const statuses = JSON.parse(out) as Array<{ name: string }>;
    expect(statuses.map((s) => s.name)).toEqual(["typesafe", "claude", "codex", "google"]);
    expect(statuses[0]).toEqual({
      name: "typesafe",
      source: "env",
      backend: "file",
      fingerprint: credentialFingerprint("placeholder-env-key"),
      helperCommand: null,
      helperResult: null,
      envVar: "TYPESAFE_API_KEY",
      storePath: join(home, "credentials.json"),
    });
    expect(out).not.toContain(VALUE);
    expect(out).not.toContain("placeholder-env-key");
  });

  it("names a helper without running it, and runs it only with --check", async () => {
    const calls: string[] = [];
    const helperExec = ((file: string) => {
      calls.push(file);
      return VALUE;
    }) as never;
    const runWith = (argv: string[]) =>
      runCredentialsCli(argv, {
        readStdin: async () => null,
        stdout: (t) => { out += t; },
        stderr: (t) => { err += t; },
        store: { ndxHome: home, env: {}, helperExec },
      });
    expect(await run(["set-helper", "typesafe"], JSON.stringify(["op", "read", "op://v/i/f"]))).toBe(0);
    out = "";
    expect(await runWith(["status"])).toBe(0);
    expect(out).toContain("typesafe: credential store, helper (op), not run (--check runs it)");
    expect(calls).toEqual([]);
    out = "";
    expect(await runWith(["status", "--check"])).toBe(0);
    expect(out).toContain(`typesafe: credential store, helper (op), fingerprint ${credentialFingerprint(VALUE)}`);
    expect(calls).toEqual(["op"]);
    expect(out + err).not.toContain(VALUE);
  });

  it("says not set when nothing is", async () => {
    expect(await run(["status"])).toBe(0);
    expect(out).toContain("typesafe: not set");
  });
});

describe("test typesafe", () => {
  const withFetch = (status: number) => (argv: string[]) =>
    runCredentialsCli(argv, {
      readStdin: async () => null,
      stdout: (t) => { out += t; },
      stderr: (t) => { err += t; },
      store: { ndxHome: home, env: {} },
      fetchImpl: (async () => new Response("{}", { status })) as unknown as typeof fetch,
    });

  it.each([
    [200, 0, "ok"],
    [401, 1, "rejected"],
    [503, 1, "unreachable"],
  ])("HTTP %i exits %i and reports %s with the fingerprint, never the key", async (status, code, word) => {
    await run(["set", "typesafe"], VALUE);
    out = "";
    expect(await withFetch(status)(["test", "typesafe"])).toBe(code);
    expect(out + err).toContain(`typesafe: ${word} (fingerprint ${credentialFingerprint(VALUE)})`);
    expect(out + err).not.toContain(VALUE);
  });

  it("reports no key without a request, and refuses a vendor name", async () => {
    expect(await withFetch(200)(["test", "typesafe"])).toBe(1);
    expect(err).toContain("no key");
    expect(await withFetch(200)(["test", "claude"])).toBe(2);
  });
});

describe("usage", () => {
  it("exits 2 on an unknown command or none", async () => {
    expect(await run(["get", "typesafe"])).toBe(2);
    expect(await run([])).toBe(2);
    expect(await run(["--help"])).toBe(0);
  });
});
