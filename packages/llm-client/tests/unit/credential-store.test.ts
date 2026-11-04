/**
 * The per-user credential store: lookup order, format, permissions, lock.
 *
 * Every test uses its own temp ndx home and placeholder values; none reads the
 * developer's real store. The cross-process two-writer test spawns the built
 * library and lives in tests/e2e/credential-store-writers.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  EMPTY_LOCK_STALE_MS,
  TAKEOVER_GUARD_STALE_MS,
  credentialStatus,
  credentialStorePath,
  inspectLock,
  parseIcaclsOutput,
  takeOverStaleLock,
  takeoverGuardPath,
  resolveCredential,
  restrictToOwnerWindows,
  setCredential,
  unsetCredential,
  type CredentialWriteOptions,
} from "../../src/credential-store.js";

const isWindows = platform() === "win32";
const PLACEHOLDER = "placeholder-file-key";

let home: string;
let warnings: string[];
let options: CredentialWriteOptions;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ndx-cred-store-"));
  warnings = [];
  options = { ndxHome: home, env: {}, warn: (m) => warnings.push(m) };
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const storePath = (): string => join(home, "credentials.json");
const readStoreJson = (): any => JSON.parse(readFileSync(storePath(), "utf-8"));

describe("credentialStorePath", () => {
  it("is credentials.json in the ndx home", () => {
    expect(credentialStorePath({ ndxHome: home })).toBe(storePath());
  });

  it("follows NDX_HOME when no ndx home is given", () => {
    expect(credentialStorePath({ env: { NDX_HOME: home } })).toBe(storePath());
  });
});

describe("resolveCredential", () => {
  it("is undefined when neither the environment nor the store holds one", () => {
    expect(resolveCredential("typesafe", options)).toBeUndefined();
  });

  it("reads the store when the environment variable is unset", () => {
    setCredential("typesafe", PLACEHOLDER, options);
    expect(resolveCredential("typesafe", options)).toEqual({ value: PLACEHOLDER, source: "file" });
  });

  it("prefers a non-blank TYPESAFE_API_KEY over a different stored value", () => {
    setCredential("typesafe", PLACEHOLDER, options);
    const env = { TYPESAFE_API_KEY: "placeholder-env-key" };
    expect(resolveCredential("typesafe", { ...options, env })).toEqual({ value: "placeholder-env-key", source: "env" });
  });

  it("ignores a blank TYPESAFE_API_KEY", () => {
    setCredential("typesafe", PLACEHOLDER, options);
    expect(resolveCredential("typesafe", { ...options, env: { TYPESAFE_API_KEY: "  " } })?.source).toBe("file");
  });

  it("reads a name with no environment variable from the store alone", () => {
    setCredential("connection:jira-1", "placeholder-token", options);
    expect(resolveCredential("connection:jira-1", options)).toEqual({ value: "placeholder-token", source: "file" });
  });

  it("does not return an entry whose backend it does not know", () => {
    writeFileSync(storePath(), JSON.stringify({ version: 1, entries: { typesafe: { backend: "helper", command: "pass x" } } }), { mode: 0o600 });
    expect(resolveCredential("typesafe", options)).toBeUndefined();
  });
});

describe("entry names", () => {
  it.each(["typesafe", "connection:abc-1", "a.b_c", "0x"])("accepts %s", (name) => {
    expect(() => setCredential(name, PLACEHOLDER, options)).not.toThrow();
  });

  it.each(["", "Typesafe", "-x", ":x", "a b", "a/b"])("refuses %j", (name) => {
    expect(() => setCredential(name, PLACEHOLDER, options)).toThrow(/Invalid credential name/);
    expect(() => resolveCredential(name, options)).toThrow(/Invalid credential name/);
  });
});

describe("file format", () => {
  it("writes {version: 1, entries: {<name>: {backend: file, value, updatedAt}}}", () => {
    setCredential("typesafe", `  ${PLACEHOLDER}\n`, options);
    const store = readStoreJson();
    expect(store).toEqual({
      version: 1,
      entries: { typesafe: { backend: "file", value: PLACEHOLDER, updatedAt: expect.any(String) } },
    });
    expect(Number.isNaN(Date.parse(store.entries.typesafe.updatedAt))).toBe(false);
  });

  it("refuses an empty or multi-line value", () => {
    expect(() => setCredential("typesafe", "   ", options)).toThrow(/empty/);
    expect(() => setCredential("typesafe", "a\nb", options)).toThrow(/multi-line/);
    expect(existsSync(storePath())).toBe(false);
  });

  it("keeps unknown top-level and entry fields, and other entries, across a write", () => {
    writeFileSync(storePath(), JSON.stringify({
      version: 1,
      future: { kept: true },
      entries: {
        typesafe: { backend: "file", value: "old-placeholder", updatedAt: "2026-01-01T00:00:00.000Z", note: "kept" },
        "connection:x": { backend: "file", value: "other-placeholder", updatedAt: "2026-01-01T00:00:00.000Z" },
      },
    }), { mode: 0o600 });

    setCredential("typesafe", PLACEHOLDER, options);

    const store = readStoreJson();
    expect(store.future).toEqual({ kept: true });
    expect(store.entries.typesafe).toMatchObject({ backend: "file", value: PLACEHOLDER, note: "kept" });
    expect(store.entries["connection:x"].value).toBe("other-placeholder");
  });

  it("never overwrites a store of an unknown version, and reads it as empty with one warning", () => {
    const original = JSON.stringify({ version: 2, entries: { typesafe: { backend: "file", value: PLACEHOLDER } } });
    writeFileSync(storePath(), original, { mode: 0o600 });

    expect(resolveCredential("typesafe", options)).toBeUndefined();
    expect(resolveCredential("typesafe", options)).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/version 2/);

    expect(() => setCredential("typesafe", "new-placeholder", options)).toThrow(/Refusing to overwrite/);
    expect(() => unsetCredential("typesafe", options)).toThrow(/Refusing to overwrite/);
    expect(readFileSync(storePath(), "utf-8")).toBe(original);
  });

  it("does not quote an unparseable store in its warning", () => {
    writeFileSync(storePath(), `{"version": 1, "entries": {"typesafe": {"value": "${PLACEHOLDER}"`, { mode: 0o600 });
    expect(resolveCredential("typesafe", options)).toBeUndefined();
    expect(warnings.join("\n")).not.toContain(PLACEHOLDER);
    expect(() => setCredential("typesafe", "x", options)).toThrow(/not valid JSON/);
  });
});

describe("unsetCredential", () => {
  it("removes the entry, keeps the others, and reports whether anything was removed", () => {
    setCredential("typesafe", PLACEHOLDER, options);
    setCredential("connection:x", "other-placeholder", options);
    expect(unsetCredential("typesafe", options)).toBe(true);
    expect(unsetCredential("typesafe", options)).toBe(false);
    expect(resolveCredential("typesafe", options)).toBeUndefined();
    expect(Object.keys(readStoreJson().entries)).toEqual(["connection:x"]);
  });

  it("does not create a store when there is nothing to remove", () => {
    expect(unsetCredential("typesafe", options)).toBe(false);
    expect(existsSync(storePath())).toBe(false);
  });
});

describe("atomic write", () => {
  it("leaves no temp or lock file behind", () => {
    setCredential("typesafe", PLACEHOLDER, options);
    setCredential("typesafe", "second-placeholder", options);
    expect(readdirSync(home)).toEqual(["credentials.json"]);
  });
});

describe.skipIf(isWindows)("POSIX permissions", () => {
  it("ends with the file 0600 and its directory 0700", () => {
    const dir = join(home, "nested-home");
    chmodSync(home, 0o755);
    setCredential("typesafe", PLACEHOLDER, { ...options, ndxHome: dir });
    expect(statSync(join(dir, "credentials.json")).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);

    chmodSync(dir, 0o755);
    setCredential("typesafe", PLACEHOLDER, { ...options, ndxHome: dir });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it("refuses a group- or world-readable store with a warning naming the fix, once", () => {
    setCredential("typesafe", PLACEHOLDER, options);
    chmodSync(storePath(), 0o644);

    expect(resolveCredential("typesafe", options)).toBeUndefined();
    expect(resolveCredential("typesafe", options)).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`chmod 600 ${storePath()}`);
    expect(warnings[0]).not.toContain(PLACEHOLDER);

    chmodSync(storePath(), 0o640);
    expect(resolveCredential("typesafe", options)).toBeUndefined();

    // The fix is seen without a restart.
    chmodSync(storePath(), 0o600);
    expect(resolveCredential("typesafe", options)?.value).toBe(PLACEHOLDER);
  });

  // Root ignores directory permissions, so the EACCES this needs never happens.
  it.skipIf(process.getuid?.() === 0)("reads an ndx home it cannot search as empty, warning once, never throwing", () => {
    const dir = join(home, "locked-home");
    setCredential("typesafe", PLACEHOLDER, { ...options, ndxHome: dir });
    chmodSync(dir, 0o000);
    try {
      expect(resolveCredential("typesafe", { ...options, ndxHome: dir })).toBeUndefined();
      expect(resolveCredential("typesafe", { ...options, ndxHome: dir })).toBeUndefined();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("EACCES");
    } finally {
      chmodSync(dir, 0o700);
    }
    // Once readable again, the key is found without a restart.
    expect(resolveCredential("typesafe", { ...options, ndxHome: dir })?.value).toBe(PLACEHOLDER);
  });

  it("a write replaces a too-open store with an owner-only one", () => {
    setCredential("typesafe", PLACEHOLDER, options);
    chmodSync(storePath(), 0o644);
    setCredential("typesafe", PLACEHOLDER, options);
    expect(statSync(storePath()).mode & 0o777).toBe(0o600);
  });
});

describe("read cache", () => {
  it("sees a rewrite by another writer without a restart", () => {
    setCredential("typesafe", PLACEHOLDER, options);
    expect(resolveCredential("typesafe", options)?.value).toBe(PLACEHOLDER);

    // Another process's write: new content, a later mtime.
    writeFileSync(storePath(), JSON.stringify({
      version: 1,
      entries: { typesafe: { backend: "file", value: "rewritten-placeholder", updatedAt: "2026-01-01T00:00:00.000Z" } },
    }), { mode: 0o600 });
    expect(resolveCredential("typesafe", options)?.value).toBe("rewritten-placeholder");
  });

  it("sees a removed store", () => {
    setCredential("typesafe", PLACEHOLDER, options);
    expect(resolveCredential("typesafe", options)).toBeDefined();
    rmSync(storePath());
    expect(resolveCredential("typesafe", options)).toBeUndefined();
  });
});

describe("credentialStatus", () => {
  const fingerprint = (v: string): string => createHash("sha256").update(v).digest("hex").slice(0, 8);

  it("reports source, backend and an 8-character fingerprint, never the value", () => {
    setCredential("typesafe", PLACEHOLDER, options);
    const status = credentialStatus("typesafe", options);
    expect(status).toEqual({
      name: "typesafe",
      source: "file",
      backend: "file",
      fingerprint: fingerprint(PLACEHOLDER),
      helperCommand: null,
      helperResult: null,
      envVar: "TYPESAFE_API_KEY",
      storePath: storePath(),
      storeProblem: null,
    });
    expect(JSON.stringify(status)).not.toContain(PLACEHOLDER);
  });

  it("fingerprints the environment's value when it wins, and still names the stored backend", () => {
    setCredential("typesafe", PLACEHOLDER, options);
    const status = credentialStatus("typesafe", { ...options, env: { TYPESAFE_API_KEY: "placeholder-env-key" } });
    expect(status).toMatchObject({ source: "env", backend: "file", fingerprint: fingerprint("placeholder-env-key") });
  });

  it("is all null when nothing is set", () => {
    expect(credentialStatus("typesafe", options)).toMatchObject({ source: null, backend: null, fingerprint: null });
  });
});

describe("cross-process lock", () => {
  const lockPath = (): string => `${storePath()}.lock`;

  it("waits for a live holder and fails naming it", () => {
    writeFileSync(lockPath(), JSON.stringify({ pid: process.pid, token: "other", since: "2026-01-01T00:00:00.000Z" }));
    expect(() => setCredential("typesafe", PLACEHOLDER, { ...options, lockTimeoutMs: 100 }))
      .toThrow(new RegExp(`held by PID ${process.pid}`));
    // The other holder's lock is left alone.
    expect(existsSync(lockPath())).toBe(true);
    expect(existsSync(storePath())).toBe(false);
  });

  it("takes over a lock whose holder is dead", () => {
    const dead = spawnSync(process.execPath, ["-e", ""]);
    writeFileSync(lockPath(), JSON.stringify({ pid: dead.pid, token: "dead", since: "2026-01-01T00:00:00.000Z" }));
    setCredential("typesafe", PLACEHOLDER, { ...options, lockTimeoutMs: 1_000 });
    expect(resolveCredential("typesafe", options)?.value).toBe(PLACEHOLDER);
    expect(existsSync(lockPath())).toBe(false);
  });

  it("takes over an empty lock older than the threshold", () => {
    writeFileSync(lockPath(), "");
    const old = (Date.now() - EMPTY_LOCK_STALE_MS - 1_000) / 1_000;
    utimesSync(lockPath(), old, old);
    setCredential("typesafe", PLACEHOLDER, { ...options, lockTimeoutMs: 1_000 });
    expect(resolveCredential("typesafe", options)?.value).toBe(PLACEHOLDER);
    expect(existsSync(lockPath())).toBe(false);
  });

  it("waits for a fresh empty lock: its writer is still writing it", () => {
    writeFileSync(lockPath(), "");
    expect(() => setCredential("typesafe", PLACEHOLDER, { ...options, lockTimeoutMs: 100 })).toThrow(/Timed out/);
    expect(existsSync(lockPath())).toBe(true);
  });

  it("never removes a live lock that replaced the one judged stale", () => {
    const dead = spawnSync(process.execPath, ["-e", ""]);
    writeFileSync(lockPath(), JSON.stringify({ pid: dead.pid, token: "dead", since: "2026-01-01T00:00:00.000Z" }));
    const judged = inspectLock(lockPath());
    expect(judged).toBeDefined();
    // Another writer takes the dead lock over and creates its own live lock.
    expect(takeOverStaleLock(lockPath(), judged!)).toBe(true);
    const live = JSON.stringify({ pid: process.pid, token: "live", since: "2026-01-01T00:00:00.000Z" });
    writeFileSync(lockPath(), live, { flag: "wx" });
    // A second writer acting on its earlier judgement leaves the live lock in place.
    expect(takeOverStaleLock(lockPath(), judged!)).toBe(false);
    expect(readFileSync(lockPath(), "utf-8")).toBe(live);
    expect(readdirSync(dirname(lockPath())).filter((f) => f.endsWith(".takeover"))).toEqual([]);
  });

  it("waits while another writer holds the takeover guard, and reclaims an abandoned one", () => {
    const dead = spawnSync(process.execPath, ["-e", ""]);
    writeFileSync(lockPath(), JSON.stringify({ pid: dead.pid, token: "dead", since: "2026-01-01T00:00:00.000Z" }));
    const judged = inspectLock(lockPath())!;
    const guard = takeoverGuardPath(lockPath(), judged);
    writeFileSync(guard, "");
    expect(takeOverStaleLock(lockPath(), judged)).toBe(false);
    expect(existsSync(lockPath())).toBe(true);
    const old = (Date.now() - TAKEOVER_GUARD_STALE_MS - 1_000) / 1_000;
    utimesSync(guard, old, old);
    setCredential("typesafe", PLACEHOLDER, { ...options, lockTimeoutMs: 1_000 });
    expect(existsSync(lockPath())).toBe(false);
    expect(existsSync(guard)).toBe(false);
  });
});

describe("Windows owner-only ACL", () => {
  type Call = { binary: string; args: string[] };

  /** An icacls stand-in: records calls and answers reads with `aclAfter`. */
  function fakeIcacls(aclAfter: (path: string) => string[]) {
    const calls: Call[] = [];
    const impl = ((binary: string, args: string[]) => {
      calls.push({ binary, args });
      return args.length === 1 ? `${args[0]} ${aclAfter(args[0]).join("\n    ")}\n\nSuccessfully processed 1 files` : "";
    }) as unknown as CredentialWriteOptions["execFileSyncImpl"];
    return { calls, impl };
  }

  it("the writer restricts the temp file to the owner with icacls before the rename", () => {
    const { calls, impl } = fakeIcacls(() => ["DOMAIN\\alice:(F)"]);
    setCredential("typesafe", PLACEHOLDER, {
      ...options, platform: "win32", execFileSyncImpl: impl, username: "alice", env: { USERDOMAIN: "DOMAIN" },
    });

    expect(calls[0].binary).toBe("icacls");
    const [target, ...rest] = calls[0].args;
    expect(rest).toEqual(["/inheritance:r", "/grant:r", "DOMAIN\\alice:F"]);
    expect(target.startsWith(`${storePath()}.`)).toBe(true);
    expect(target.endsWith(".tmp")).toBe(true);
    expect(calls[1]).toEqual({ binary: "icacls", args: [target] });
    expect(warnings).toEqual([]);
    expect(resolveCredential("typesafe", { ...options, platform: "win32" })?.value).toBe(PLACEHOLDER);
    // No credential value ever reaches icacls.
    expect(JSON.stringify(calls)).not.toContain(PLACEHOLDER);
  });

  it("removes leftover explicit ACEs held by other principals", () => {
    let removed = false;
    const calls: Call[] = [];
    const impl = ((binary: string, args: string[]) => {
      calls.push({ binary, args });
      if (args.includes("/remove")) removed = true;
      if (args.length !== 1) return "";
      return removed ? `${args[0]} alice:(F)` : `${args[0]} NT AUTHORITY\\SYSTEM:(F)\n    alice:(F)`;
    }) as unknown as typeof import("../../src/exec.js").execFileSyncCli;

    const result = restrictToOwnerWindows("C:\\x\\credentials.json", { execFileSyncImpl: impl, username: "alice", env: {} });
    expect(result.restricted).toBe(true);
    expect(calls[2].args).toEqual(["C:\\x\\credentials.json", "/remove", "NT AUTHORITY\\SYSTEM"]);
  });

  it("warns when inheritance is still in effect after icacls", () => {
    const { impl } = fakeIcacls(() => ["BUILTIN\\Users:(I)(RX)", "alice:(F)"]);
    setCredential("typesafe", PLACEHOLDER, { ...options, platform: "win32", execFileSyncImpl: impl, username: "alice" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/inheritance is still in effect/);
  });

  it("never throws when icacls fails", () => {
    const impl = (() => { throw new Error("icacls missing"); }) as unknown as CredentialWriteOptions["execFileSyncImpl"];
    expect(restrictToOwnerWindows("C:\\x", { execFileSyncImpl: impl, username: "alice", env: {} }))
      .toEqual({ restricted: false, detail: "icacls failed: icacls missing" });
  });

  it("parses icacls output with the path on the first line", () => {
    const path = "C:\\Users\\a b\\credentials.json";
    expect(parseIcaclsOutput(`${path} NT AUTHORITY\\SYSTEM:(I)(F)\r\n    a b:(F)\r\n\r\nSuccessfully processed 1 files`, path))
      .toEqual([{ identity: "NT AUTHORITY\\SYSTEM", flags: ["I", "F"] }, { identity: "a b", flags: ["F"] }]);
  });
});
