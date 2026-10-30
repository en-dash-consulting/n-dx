import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { CLI_PATH, DEFAULT_TIMEOUT } from "./e2e-helpers.js";

const isWin = process.platform === "win32";
// Placeholder only: any real-looking key would trip secret scanners.
const SECRET = "tsk-placeholder-credential-0123456789";

let home;
let cwd;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "ndx-cfg-cred-home-"));
  cwd = await mkdtemp(join(tmpdir(), "ndx-cfg-cred-cwd-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

function config(args, input) {
  const env = { ...process.env, NDX_HOME: home };
  delete env.N_DX_HOME;
  delete env.TYPESAFE_API_KEY;
  const r = spawnSync(process.execPath, [CLI_PATH, "config", ...args], {
    cwd,
    env,
    input: input ?? "",
    encoding: "utf-8",
    timeout: DEFAULT_TIMEOUT,
  });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

async function everyFileUnder(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) found.push(join(entry.parentPath ?? entry.path, entry.name));
  }
  return found;
}

describe("ndx config credentials", () => {
  it("stores a piped value 0600 in a 0700 dir and never prints it", async () => {
    const set = config(["credentials.typesafe", "--stdin"], `${SECRET}\n`);
    expect(set.code).toBe(0);

    const store = join(home, "credentials.json");
    expect(JSON.parse(await readFile(store, "utf-8"))).toBeTruthy();
    if (!isWin) {
      expect((await stat(store)).mode & 0o777).toBe(0o600);
      expect((await stat(home)).mode & 0o777).toBe(0o700);
    }

    const status = config(["credentials"]);
    expect(status.code).toBe(0);
    expect(status.out).toContain("typesafe");
    expect(status.out).toMatch(/fingerprint/);
    expect(status.out).toMatch(/per-user/);
    expect(status.out).toMatch(/directory argument is ignored/);

    // The value is in the store file alone: no output, no log under the cwd or home.
    for (const text of [set.out, set.err, status.out, status.err]) {
      expect(text).not.toContain(SECRET);
    }
    for (const file of [...(await everyFileUnder(cwd)), ...(await everyFileUnder(home))]) {
      if (file === store) continue;
      expect(await readFile(file, "utf-8")).not.toContain(SECRET);
    }
  }, DEFAULT_TIMEOUT);

  it("accepts a value on argv with a history warning, and --unset removes it", () => {
    const set = config(["credentials.typesafe", SECRET]);
    expect(set.code).toBe(0);
    expect(set.err).toMatch(/shell history/);
    expect(set.err).not.toContain(SECRET);
    expect(set.out).not.toContain(SECRET);

    expect(config(["credentials.typesafe", "--unset"]).code).toBe(0);
    expect(config(["credentials"]).out).toMatch(/typesafe: not set/);
  }, DEFAULT_TIMEOUT);

  it("refuses vendor credentials", () => {
    const r = config(["credentials.claude", "--stdin"], `${SECRET}\n`);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/later release/);
    expect(r.err).not.toContain(SECRET);
  }, DEFAULT_TIMEOUT);

  it("refuses to wait on a non-TTY with no value", () => {
    const r = config(["credentials.typesafe"]);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/--stdin/);
  }, DEFAULT_TIMEOUT);

  it("documents credentials in --help", () => {
    const r = config(["--help"]);
    expect(r.out).toMatch(/credentials\.typesafe/);
    expect(r.out).toMatch(/--stdin/);
    expect(r.out).toMatch(/--unset/);
  }, DEFAULT_TIMEOUT);
});
