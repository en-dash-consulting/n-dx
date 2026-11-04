/**
 * The credential store's helper backend: an entry holding a password-manager
 * command's argv, run without a shell when the value is needed.
 *
 * The fake helper is a node script in a temp directory, so it runs the same
 * way on every platform (`node <script> <mode>`). It prints a placeholder,
 * never a real secret, and the tests assert the placeholder never reaches a
 * warning.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CREDENTIAL_HELPER_RETRY_MS,
  CREDENTIAL_HELPER_TIMEOUT_MS,
  agentCredentialDenials,
  clearCredentialHelperCache,
  credentialStatus,
  hasStoredCredential,
  interpreterHelperPrefix,
  resolveCredential,
  setCredential,
  setHelperCredential,
  type CredentialWriteOptions,
} from "../../src/credential-store.js";
import { execFileSyncNoShell } from "../../src/exec.js";

const SECRET = "placeholder-helper-secret";
const STDERR_TEXT = "placeholder-helper-stderr";

let home: string;
let warnings: string[];
let options: CredentialWriteOptions;
let helperScript: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ndx-cred-helper-"));
  warnings = [];
  options = { ndxHome: home, env: {}, warn: (m) => warnings.push(m) };
  helperScript = join(home, "fake-helper.mjs");
  writeFileSync(
    helperScript,
    [
      'import { readFileSync } from "node:fs";',
      "const mode = process.argv[2];",
      `const secret = ${JSON.stringify(SECRET)};`,
      `process.stderr.write(${JSON.stringify(STDERR_TEXT)} + " " + secret + "\\n");`,
      'if (mode === "ok") process.stdout.write("  " + secret + "\\n");',
      'if (mode === "fail") { process.stdout.write(secret); process.exit(3); }',
      'if (mode === "multi") process.stdout.write(secret + "\\nsecond\\n");',
      'if (mode === "cwd") process.stdout.write(process.cwd());',
      'if (mode === "stdin") process.stdout.write(readFileSync(0, "utf-8") || "stdin-closed");',
    ].join("\n"),
  );
  clearCredentialHelperCache();
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  clearCredentialHelperCache();
});

const storeJson = (): any => JSON.parse(readFileSync(join(home, "credentials.json"), "utf-8"));
const fakeArgv = (mode: string): string[] => [process.execPath, helperScript, mode];

/** A helperExec that records its calls and returns `stdout`, or throws `error`. */
function recordingExec(result: { stdout?: string; error?: object }) {
  const calls: Array<{ file: string; args: readonly string[]; opts: any }> = [];
  const exec = ((file: string, args: readonly string[], opts: any) => {
    calls.push({ file, args, opts });
    if (result.error) throw Object.assign(new Error(`failed with ${SECRET} ${STDERR_TEXT}`), result.error);
    return result.stdout ?? "";
  }) as unknown as typeof execFileSyncNoShell;
  return { exec, calls };
}

describe("helper entries", () => {
  it("are {backend: helper, argv, updatedAt}", () => {
    setHelperCredential("typesafe", ["op", "read", "op://vault/item/field"], options);
    expect(storeJson().entries.typesafe).toEqual({
      backend: "helper",
      argv: ["op", "read", "op://vault/item/field"],
      updatedAt: expect.any(String),
    });
  });

  it.each([
    [[], /non-empty/],
    [[""], /empty/],
    [["-x"], /start with "-"/],
    [["op,x"], /comma/],
    [["op", "a\nb"], /line break/],
  ])("refuses argv %j", (argv, message) => {
    expect(() => setHelperCredential("typesafe", argv as string[], options)).toThrow(message);
  });

  it("switching file → helper drops the value and keeps unknown fields", () => {
    writeFileSync(join(home, "credentials.json"), JSON.stringify({
      version: 1,
      entries: { typesafe: { backend: "file", value: SECRET, updatedAt: "2026-01-01T00:00:00.000Z", note: "kept" } },
    }), { mode: 0o600 });
    setHelperCredential("typesafe", ["pass", "show", "typesafe"], options);
    const entry = storeJson().entries.typesafe;
    expect(entry).toMatchObject({ backend: "helper", argv: ["pass", "show", "typesafe"], note: "kept" });
    expect(entry).not.toHaveProperty("value");
  });

  it("switching helper → file drops the argv and keeps unknown fields", () => {
    writeFileSync(join(home, "credentials.json"), JSON.stringify({
      version: 1,
      entries: { typesafe: { backend: "helper", argv: ["op", "read", "x"], updatedAt: "2026-01-01T00:00:00.000Z", note: "kept" } },
    }), { mode: 0o600 });
    setCredential("typesafe", SECRET, options);
    const entry = storeJson().entries.typesafe;
    expect(entry).toMatchObject({ backend: "file", value: SECRET, note: "kept" });
    expect(entry).not.toHaveProperty("argv");
  });
});

describe("resolveCredential with a helper", () => {
  it("runs the helper and returns its trimmed stdout", () => {
    setHelperCredential("typesafe", fakeArgv("ok"), options);
    expect(resolveCredential("typesafe", options)).toEqual({ value: SECRET, source: "helper" });
    expect(warnings).toEqual([]);
  });

  it("runs argv[0] with argv.slice(1), no shell, closed stdin and a 10 s timeout", () => {
    const { exec, calls } = recordingExec({ stdout: `${SECRET}\n` });
    setHelperCredential("typesafe", ["op", "read", "op://v/i/f"], options);
    expect(resolveCredential("typesafe", { ...options, helperExec: exec })?.value).toBe(SECRET);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.file).toBe("op");
    expect(calls[0]!.args).toEqual(["read", "op://v/i/f"]);
    expect(calls[0]!.opts).toMatchObject({ timeout: CREDENTIAL_HELPER_TIMEOUT_MS });
    expect(calls[0]!.opts.stdio[0]).toBe("ignore");
    expect(CREDENTIAL_HELPER_TIMEOUT_MS).toBe(10_000);
  });

  it("the default runner never uses a shell, even when asked to", () => {
    const arg = "a b;c|d $HOME";
    const out = execFileSyncNoShell(process.execPath, ["-p", "process.argv[1]", arg], {
      encoding: "utf-8",
      ...({ shell: true } as object),
    });
    expect(String(out).trim()).toBe(arg);
  });

  it("runs the helper in the ndx home, never the caller's (possibly untrusted) cwd", () => {
    const { exec, calls } = recordingExec({ stdout: SECRET });
    setHelperCredential("typesafe", ["op", "read", "cwd-check"], options);
    resolveCredential("typesafe", { ...options, helperExec: exec });
    expect(calls[0]!.opts.cwd).toBe(home);

    setHelperCredential("claude", fakeArgv("cwd"), options);
    expect(realpathSync(resolveCredential("claude", options)!.value)).toBe(realpathSync(home));
  });

  it("gives the real helper a closed stdin", () => {
    setHelperCredential("typesafe", fakeArgv("stdin"), options);
    expect(resolveCredential("typesafe", options)?.value).toBe("stdin-closed");
  });

  it("caches the result per process by name and argv", () => {
    const { exec, calls } = recordingExec({ stdout: SECRET });
    const withExec = { ...options, helperExec: exec };
    setHelperCredential("typesafe", ["op", "read", "a"], options);
    resolveCredential("typesafe", withExec);
    resolveCredential("typesafe", withExec);
    expect(calls).toHaveLength(1);
    setHelperCredential("typesafe", ["op", "read", "b"], options);
    resolveCredential("typesafe", withExec);
    expect(calls).toHaveLength(2);
  });

  it("the environment variable wins over a helper, which is not run", () => {
    const { exec, calls } = recordingExec({ stdout: SECRET });
    setHelperCredential("typesafe", ["op", "read", "x"], options);
    const env = { TYPESAFE_API_KEY: "placeholder-env-key" };
    expect(resolveCredential("typesafe", { ...options, env, helperExec: exec })).toEqual({ value: "placeholder-env-key", source: "env" });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["empty", { stdout: "  \n" }, /printed nothing/],
    ["multi-line", { stdout: `${SECRET}\nsecond` }, /more than one line/],
  ])("treats %s stdout as a failure", (_label, result, reason) => {
    const { exec } = recordingExec(result);
    setHelperCredential("typesafe", ["op", "read", "x"], options);
    expect(resolveCredential("typesafe", { ...options, helperExec: exec })).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(reason);
    expect(warnings[0]).not.toContain(SECRET);
  });

  it("a real multi-line helper is a failure", () => {
    setHelperCredential("typesafe", fakeArgv("multi"), options);
    expect(resolveCredential("typesafe", options)).toBeUndefined();
    expect(warnings[0]).toMatch(/more than one line/);
  });
});

describe("a failing helper", () => {
  const assertQuietWarning = (pattern: RegExp): void => {
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/typesafe/);
    expect(warnings[0]).toMatch(pattern);
    expect(warnings[0]).not.toContain(SECRET);
    expect(warnings[0]).not.toContain(STDERR_TEXT);
  };

  it("returns undefined and warns once naming the entry, argv[0] and the exit code, never its output", () => {
    setHelperCredential("typesafe", fakeArgv("fail"), options);
    expect(resolveCredential("typesafe", options)).toBeUndefined();
    expect(resolveCredential("typesafe", options)).toBeUndefined();
    assertQuietWarning(/exit code 3/);
    expect(warnings[0]).toContain(JSON.stringify(process.execPath));
  });

  it("names a timeout", () => {
    const { exec } = recordingExec({ error: { code: "ETIMEDOUT", signal: "SIGTERM", status: null } });
    setHelperCredential("typesafe", ["op", "read", "x"], options);
    expect(resolveCredential("typesafe", { ...options, helperExec: exec })).toBeUndefined();
    assertQuietWarning(/"op".*timed out after 10 s/);
  });

  it("names a missing command", () => {
    setHelperCredential("typesafe", [join(home, "no-such-helper"), "x"], options);
    expect(resolveCredential("typesafe", options)).toBeUndefined();
    assertQuietWarning(/no-such-helper.*command not found/);
  });
});

describe("status and denials never run a helper", () => {
  it("credentialStatus reports the helper and argv[0] without running it", () => {
    const { exec, calls } = recordingExec({ stdout: SECRET });
    setHelperCredential("typesafe", ["op", "read", "x"], options);
    expect(credentialStatus("typesafe", { ...options, helperExec: exec })).toMatchObject({
      source: "helper",
      backend: "helper",
      helperCommand: "op",
      helperResult: "not-run",
      fingerprint: null,
    });
    expect(hasStoredCredential("typesafe", { ...options, helperExec: exec })).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("credentialStatus with check runs it and fingerprints the value", () => {
    setHelperCredential("typesafe", fakeArgv("ok"), options);
    const status = credentialStatus("typesafe", { ...options, check: true });
    expect(status).toMatchObject({ source: "helper", helperResult: "ok", fingerprint: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(JSON.stringify(status)).not.toContain(SECRET);
  });

  it("credentialStatus with check reports a failed helper", () => {
    setHelperCredential("typesafe", fakeArgv("fail"), options);
    expect(credentialStatus("typesafe", { ...options, check: true })).toMatchObject({ source: null, helperResult: "failed" });
  });

  it("agentCredentialDenials lists the Keychain read and every helper's command spellings", () => {
    const { exec, calls } = recordingExec({ stdout: SECRET });
    setHelperCredential("typesafe", ["/opt/homebrew/bin/op", "read", "x"], options);
    setHelperCredential("claude", ["C:\\Tools\\bw.exe", "get", "password", "x"], options);
    setCredential("codex", SECRET, options);
    const denials = agentCredentialDenials({ ...options, helperExec: exec });
    expect(denials.storePath).toBe(join(home, "credentials.json"));
    expect(denials.commandPrefixes).toEqual(expect.arrayContaining([
      ["security", "find-generic-password"],
      ["/opt/homebrew/bin/op"],
      ["op"],
      ["C:\\Tools\\bw.exe"],
      ["bw.exe"],
      ["bw"],
    ]));
    expect(denials.commandPrefixes).toHaveLength(6);
    expect(calls).toHaveLength(0);
  });
});

describe("an interpreter helper denies its script, not the interpreter", () => {
  const prefixes = (argv: string[]): string[][] => {
    setHelperCredential("typesafe", argv, options);
    return agentCredentialDenials(options).commandPrefixes.filter((p) => p[0] !== "security");
  };

  it("node <script> yields node <script>, never bare node", () => {
    expect(prefixes(["node", "/x/get-key.mjs"])).toEqual([["node", "/x/get-key.mjs"]]);
  });

  it("options before the script stay in the prefix, which is also denied without them", () => {
    expect(prefixes(["node", "--no-warnings", "/x/get-key.mjs", "--vault", "v"])).toEqual([
      ["node", "--no-warnings", "/x/get-key.mjs"],
      ["node", "/x/get-key.mjs"],
    ]);
  });

  it("every spelling of the interpreter carries the script", () => {
    expect(prefixes(["C:\\Program Files\\nodejs\\node.exe", "C:\\x\\get-key.mjs"])).toEqual([
      ["C:\\Program Files\\nodejs\\node.exe", "C:\\x\\get-key.mjs"],
      ["node.exe", "C:\\x\\get-key.mjs"],
      ["node", "C:\\x\\get-key.mjs"],
    ]);
  });

  it.each([
    [["python3", "-I", "get-key.py"], ["python3", "-I", "get-key.py"]],
    [["python3.12", "-m", "getkey"], ["python3.12", "-m", "getkey"]],
    [["bash", "get-key.sh"], ["bash", "get-key.sh"]],
    [["deno", "run", "--allow-env", "get-key.ts"], ["deno", "run", "--allow-env", "get-key.ts"]],
    [["pwsh", "-File", "get-key.ps1"], ["pwsh", "-File", "get-key.ps1"]],
  ])("%j yields the prefix %j", (argv, prefix) => {
    expect(prefixes(argv)).toContainEqual(prefix);
    expect(prefixes(argv)).not.toContainEqual([argv[0]]);
  });

  it("a non-interpreter helper keeps its argv[0] prefixes", () => {
    expect(prefixes(["op", "read", "op://vault/item/field"])).toEqual([["op"]]);
  });

  it.each([
    [["bash", "-c", "op read x"]],
    [["sh", "-xc", "op read x"]],
    [["node", "-e", "1"]],
    [["node", "--eval=1"]],
    [["python3", "-c", "print(1)"]],
    [["perl", "-le", "print 1"]],
    [["pwsh", "-Command", "Get-Secret"]],
    [["deno", "eval", "1"]],
    [["node"]],
    [["bash", "-x"]],
  ])("refuses to store %j, which has no script", (argv) => {
    expect(() => setHelperCredential("typesafe", argv, options)).toThrow(/is a shell, not a helper/);
  });

  // CodeQL js/polynomial-redos: the cluster check is one linear match, so a
  // long letter run with no inline-code letter is an option, not inline code.
  it("reads a long option cluster with no inline-code letter as an option", () => {
    expect(interpreterHelperPrefix(["sh", `-${"x".repeat(50_000)}`, "/x/get-key.sh"])?.prefix).toEqual([
      "sh",
      `-${"x".repeat(50_000)}`,
      "/x/get-key.sh",
    ]);
    expect(interpreterHelperPrefix(["perl", `-${"l".repeat(50_000)}`, "/x/get-key.pl"])?.prefix).toHaveLength(3);
  });

  it("an older store's scriptless interpreter helper still denies the bare interpreter", () => {
    writeFileSync(
      join(home, "credentials.json"),
      JSON.stringify({ version: 1, entries: { typesafe: { backend: "helper", argv: ["bash", "-c", "op read x"] } } }),
      { mode: 0o600 },
    );
    expect(agentCredentialDenials(options).commandPrefixes).toContainEqual(["bash"]);
  });
});

describe("a failed helper is retried after the window", () => {
  let now: number;
  const clock = (): number => now;
  beforeEach(() => {
    now = 1_000_000;
  });

  /** A helperExec that fails until `unlocked` is set, then prints the placeholder. */
  function lockedExec() {
    const state = { unlocked: false, calls: 0 };
    const exec = (() => {
      state.calls++;
      if (!state.unlocked) throw Object.assign(new Error("locked"), { status: 1 });
      return SECRET;
    }) as unknown as typeof execFileSyncNoShell;
    return { exec, state };
  }

  it("keeps a failure for 60 s, then runs the helper again and keeps the success", () => {
    const { exec, state } = lockedExec();
    const opts = { ...options, helperExec: exec, clock };
    setHelperCredential("typesafe", ["op", "read", "x"], options);
    expect(resolveCredential("typesafe", opts)).toBeUndefined();
    now += CREDENTIAL_HELPER_RETRY_MS - 1;
    expect(resolveCredential("typesafe", opts)).toBeUndefined();
    expect(state.calls).toBe(1);

    state.unlocked = true;
    now += 1;
    expect(resolveCredential("typesafe", opts)).toEqual({ value: SECRET, source: "helper" });
    expect(state.calls).toBe(2);

    now += 10 * CREDENTIAL_HELPER_RETRY_MS;
    expect(resolveCredential("typesafe", opts)).toEqual({ value: SECRET, source: "helper" });
    expect(state.calls).toBe(2);
  });

  it.each([
    ["exit code", { status: 1 }],
    ["timeout", { code: "ETIMEDOUT", signal: "SIGTERM", status: null }],
    ["missing command", { code: "ENOENT" }],
  ])("warns once per failure streak (%s), not on every retry", (_label, error) => {
    const { exec, calls } = recordingExec({ error });
    const opts = { ...options, helperExec: exec, clock };
    setHelperCredential("typesafe", ["op", "read", "x"], options);
    for (let i = 0; i < 3; i++) {
      expect(resolveCredential("typesafe", opts)).toBeUndefined();
      now += CREDENTIAL_HELPER_RETRY_MS;
    }
    expect(calls).toHaveLength(3);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/retrying after 60 s/);
    expect(warnings[0]).not.toContain(SECRET);
  });
});
