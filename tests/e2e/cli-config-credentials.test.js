import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { CLI_PATH, DEFAULT_TIMEOUT } from "./e2e-helpers.js";

const isWin = process.platform === "win32";
// Placeholder only: any real-looking key would trip secret scanners.
const SECRET = "tsk-placeholder-credential-0123456789";

let root;
let home;
let cwd;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ndx-cfg-cred-home-"));
  // Not created here: mkdtemp is already 0700, so the store must create it.
  home = join(root, "ndx-home");
  cwd = await mkdtemp(join(tmpdir(), "ndx-cfg-cred-cwd-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

function config(args, input) {
  const env = { ...process.env, NDX_HOME: home };
  delete env.N_DX_HOME;
  for (const name of ["TYPESAFE_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]) delete env[name];
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

  it("treats a trailing directory as the ignored dir argument, not the value", () => {
    expect(config(["credentials.typesafe", SECRET, "."]).code).toBe(0);
    const before = config(["credentials"]).out;

    const dirOnly = config(["credentials.typesafe", "."]);
    expect(dirOnly.code).not.toBe(0);
    expect(dirOnly.err).toMatch(/--stdin/);
    expect(config(["credentials"]).out).toBe(before);
  }, DEFAULT_TIMEOUT);

  it("stores a vendor key that stays unused until llm.<vendor>.auth is api", async () => {
    const set = config(["credentials.claude", "--stdin"], `${SECRET}\n`);
    expect(set.code).toBe(0);

    const auto = config(["credentials", cwd]);
    expect(auto.code).toBe(0);
    expect(auto.out).toContain("claude: cli (store key held, unused)");
    expect(auto.out).toContain("codex: cli");

    // The auth choice is the user's own: it goes to .n-dx.local.json.
    expect(config(["llm.claude.auth", "api", cwd]).code).toBe(0);
    expect(JSON.parse(await readFile(join(cwd, ".n-dx.local.json"), "utf-8")).llm.claude.auth).toBe("api");
    const api = config(["credentials", cwd]);
    expect(api.out).toContain("claude: api (llm.claude.auth api; key from the credential store)");

    for (const text of [set.out, set.err, auto.out, auto.err, api.out, api.err]) {
      expect(text).not.toContain(SECRET);
    }
  }, DEFAULT_TIMEOUT);

  it("refuses an unknown credential name", () => {
    const r = config(["credentials.github", "--stdin"], `${SECRET}\n`);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/credentials\.claude/);
    expect(r.err).not.toContain(SECRET);
  }, DEFAULT_TIMEOUT);

  it("accepts cli, api and auto for llm.<vendor>.auth, and cli for google names api", () => {
    for (const vendor of ["claude", "codex"]) {
      for (const value of ["cli", "api", "auto"]) {
        expect(config([`llm.${vendor}.auth`, value, cwd]).code, `${vendor} ${value}`).toBe(0);
      }
      const bad = config([`llm.${vendor}.auth`, "sometimes", cwd]);
      expect(bad.code).not.toBe(0);
      expect(bad.err).toMatch(/cli, api, auto/);
    }
    expect(config(["llm.google.auth", "api", cwd]).code).toBe(0);
    const googleCli = config(["llm.google.auth", "cli", cwd]);
    expect(googleCli.code).not.toBe(0);
    expect(googleCli.err).toMatch(/"api"/);
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
    expect(r.out).toMatch(/--helper/);
    expect(r.out).toMatch(/--check/);
  }, DEFAULT_TIMEOUT);
});

describe("ndx config credentials.<name> --helper", () => {
  /**
   * A fake password manager: prints the placeholder and leaves a marker file,
   * so a test can tell whether it ran. Single-quoted paths: the command is
   * parsed with shell-style quoting, and temp paths can hold spaces.
   */
  async function fakeHelper() {
    const script = join(root, "fake-helper.mjs");
    const marker = join(root, "helper-ran");
    await writeFile(
      script,
      `import { writeFileSync } from "node:fs";\n` +
        `writeFileSync(${JSON.stringify(marker)}, "ran");\n` +
        `process.stderr.write(${JSON.stringify(`stderr ${SECRET}\n`)});\n` +
        `process.stdout.write(${JSON.stringify(`${SECRET}\n`)});\n`,
    );
    return { command: `'${process.execPath}' '${script}' --vault ndx`, script, marker };
  }

  it("stores the argv, names the helper in status, and runs it only with --check", async () => {
    const { command, script, marker } = await fakeHelper();
    const set = config(["credentials.typesafe", "--helper", command]);
    expect(set.code, set.err).toBe(0);
    expect(set.out).toContain("Stored typesafe: helper (");
    expect(existsSync(marker)).toBe(false);

    const entry = JSON.parse(await readFile(join(home, "credentials.json"), "utf-8")).entries.typesafe;
    expect(entry).toMatchObject({ backend: "helper", argv: [process.execPath, script, "--vault", "ndx"] });
    expect(entry).not.toHaveProperty("value");

    const status = config(["credentials"]);
    expect(status.code).toBe(0);
    expect(status.out).toContain(`typesafe: credential store, helper (${process.execPath}), not run (--check runs it)`);
    expect(existsSync(marker)).toBe(false);

    const checked = config(["credentials", "--check"]);
    expect(checked.code).toBe(0);
    expect(checked.out).toMatch(/typesafe: credential store, helper \(.+\), fingerprint [0-9a-f]{8}/);
    expect(existsSync(marker)).toBe(true);

    for (const text of [set.out, set.err, status.out, status.err, checked.out, checked.err]) {
      expect(text).not.toContain(SECRET);
    }
  }, DEFAULT_TIMEOUT);

  it("says the agent can still run the interpreter of an interpreter helper", async () => {
    const { command, script } = await fakeHelper();
    const set = config(["credentials.typesafe", "--helper", command]);
    expect(set.code, set.err).toBe(0);
    const notes = set.out.split("\n").filter((line) => line.startsWith("Note:"));
    expect(notes).toEqual([`Note: agents can still run node itself; only "${process.execPath} ${script}" is denied to them.`]);
  }, DEFAULT_TIMEOUT);

  it.each([
    ["bash -c", "bash -c 'op read x'"],
    ["node -e", "node -e 1"],
    ["python3 -c", "python3 -c 'print(1)'"],
  ])("refuses %s, an interpreter with no script, as a usage error and stores nothing", (_label, command) => {
    const r = config(["credentials.typesafe", "--helper", command]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/is a shell, not a helper/);
    expect(r.err.trim().split("\n")).toHaveLength(1);
    expect(r.err).not.toMatch(/usage/i);
    expect(existsSync(join(home, "credentials.json"))).toBe(false);
  }, DEFAULT_TIMEOUT);

  it("accepts the --helper=<cmd> form", async () => {
    const { command } = await fakeHelper();
    expect(config(["credentials.claude", `--helper=${command}`]).code).toBe(0);
    expect(config(["credentials"]).out).toContain(`claude: credential store, helper (${process.execPath})`);
  }, DEFAULT_TIMEOUT);

  it.each([
    ["a pipe", "op read x | cat"],
    ["a separator", "op read x; rm -rf y"],
    ["an ampersand", "op read x & y"],
    ["a redirect out", "op read x > out"],
    ["a redirect in", "op read < in"],
    ["a substitution", "op read $(whoami)"],
    ["a backtick", "op read `whoami`"],
    ["a leading dash", "-e x"],
  ])("refuses %s as a usage error and stores nothing", (_label, command) => {
    const r = config(["credentials.typesafe", "--helper", command]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Refusing --helper/);
    expect(existsSync(join(home, "credentials.json"))).toBe(false);
  }, DEFAULT_TIMEOUT);
});

describe("ndx config llm.<vendor>.api_key", () => {
  const KEY = "sk-ant-placeholder-0123456789";
  const localPath = () => join(cwd, ".n-dx.local.json");
  const readLocal = async () => JSON.parse(await readFile(localPath(), "utf-8"));

  it("writes the store with a history warning, never a config file, and never prints the value", async () => {
    const set = config(["llm.claude.api_key", KEY, cwd]);
    expect(set.code).toBe(0);
    expect(set.err).toMatch(/shell history/);
    expect(JSON.parse(await readFile(join(home, "credentials.json"), "utf-8")).entries.claude).toBeDefined();
    expect((await readLocal()).llm.claude.api_key).toBeUndefined();
    expect(existsSync(join(cwd, ".n-dx.json"))).toBe(false);

    const show = config(["llm.claude.api_key", cwd]);
    expect(show.out).toMatch(/^claude: credential store \(file\), fingerprint [0-9a-f]{8}$/m);
    for (const text of [set.out, set.err, show.out, show.err]) expect(text).not.toContain(KEY);
  }, DEFAULT_TIMEOUT);

  it("takes the legacy claude.api_key too", async () => {
    expect(config(["claude.api_key", KEY, cwd]).code).toBe(0);
    expect(config(["llm.claude.api_key", cwd]).out).toMatch(/^claude: credential store/m);
    expect((await readLocal()).llm.claude.auth).toBe("api");
  }, DEFAULT_TIMEOUT);

  it("sets llm.<vendor>.auth to api when it is unset, and says so", async () => {
    const set = config(["llm.claude.api_key", KEY, cwd]);
    expect((await readLocal()).llm.claude.auth).toBe("api");
    expect(set.out).toMatch(/llm\.claude\.auth = api \(it was unset/);
    expect(config(["credentials", cwd]).out).toContain("claude: api (llm.claude.auth api; key from the credential store)");
  }, DEFAULT_TIMEOUT);

  it("never overwrites an explicit auth", async () => {
    for (const auth of ["cli", "auto"]) {
      expect(config(["llm.claude.auth", auth, cwd]).code).toBe(0);
      const set = config(["llm.claude.api_key", KEY, cwd]);
      expect(set.code).toBe(0);
      expect((await readLocal()).llm.claude.auth).toBe(auth);
      expect(set.out).not.toContain("llm.claude.auth =");
    }
  }, DEFAULT_TIMEOUT);

  it("names a config file whose key outranks the store when showing the key", async () => {
    await writeFile(localPath(), JSON.stringify({ llm: { claude: { api_key: KEY } } }));
    const show = config(["llm.claude.api_key", cwd]);
    expect(show.code).toBe(0);
    expect(show.out).toMatch(/^claude: not set$/m);
    expect(show.out).toMatch(/\.n-dx\.local\.json also holds a claude key, which is used instead.*--import/);
    expect(show.out + show.err).not.toContain(KEY);
  }, DEFAULT_TIMEOUT);

  it("removes an older key from the config files once the store holds the new one", async () => {
    await writeFile(localPath(), JSON.stringify({ llm: { claude: { api_key: "sk-ant-old" } } }));
    expect(config(["llm.claude.api_key", KEY, cwd]).code).toBe(0);
    expect(await readFile(localPath(), "utf-8")).not.toContain("sk-ant-old");
  }, DEFAULT_TIMEOUT);
});

describe("ndx config credentials --import", () => {
  const KEY = "sk-ant-placeholder-0123456789";
  const localPath = () => join(cwd, ".n-dx.local.json");
  const seed = (llm) => writeFile(localPath(), JSON.stringify({ llm }));

  it("only says how, without --import and without a terminal", async () => {
    await seed({ claude: { api_key: KEY } });
    const r = config(["credentials", cwd]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/holds an API key \(claude\).*credentials --import/);
    expect(r.out).not.toContain(KEY);
    expect(await readFile(localPath(), "utf-8")).toContain(KEY);
    expect(existsSync(join(home, "credentials.json"))).toBe(false);
  }, DEFAULT_TIMEOUT);

  it("moves every key without a prompt and applies the auth rule per vendor", async () => {
    await seed({ claude: { api_key: KEY }, codex: { api_key: "sk-codex-placeholder", auth: "cli" } });
    const r = config(["credentials", "--import", cwd]);
    expect(r.code).toBe(0);
    for (const text of [r.out, r.err]) expect(text).not.toContain(KEY);

    const local = JSON.parse(await readFile(localPath(), "utf-8"));
    expect(local.llm.claude).toEqual({ auth: "api" });
    expect(local.llm.codex).toEqual({ auth: "cli" });
    const status = config(["credentials", cwd]).out;
    expect(status).toMatch(/^claude: credential store/m);
    expect(status).toMatch(/^codex: credential store/m);
  }, DEFAULT_TIMEOUT);

  it("skips a vendor whose store entry is a helper and leaves its file key in place", async () => {
    const helper = config(["credentials.claude", "--helper", "op read op://vault/claude/key"]);
    expect(helper.code, helper.err).toBe(0);
    const storePath = join(home, "credentials.json");
    const before = JSON.parse(await readFile(storePath, "utf-8")).entries.claude;
    await seed({ claude: { api_key: KEY } });

    const r = config(["credentials", "--import", cwd]);
    expect(r.code, r.err).toBe(0);
    expect(JSON.parse(await readFile(storePath, "utf-8")).entries.claude).toEqual(before);
    expect(await readFile(localPath(), "utf-8")).toContain(KEY);
    const skipped = (r.out + r.err).split("\n").filter((l) => /Skipped the claude key/.test(l));
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain(".n-dx.local.json");
    expect(r.out + r.err).not.toContain(KEY);
  }, DEFAULT_TIMEOUT);

  const storedClaude = async () => JSON.parse(await readFile(join(home, "credentials.json"), "utf-8")).entries.claude;
  const fingerprintOf = (value) => createHash("sha256").update(value).digest("hex").slice(0, 8);

  it("removes a key the store already holds from the file without rewriting the store", async () => {
    expect(config(["credentials.claude", "--stdin"], KEY).code).toBe(0);
    const storePath = join(home, "credentials.json");
    const before = await readFile(storePath, "utf-8");
    const mtime = (await stat(storePath)).mtimeMs;
    await seed({ claude: { api_key: KEY } });

    const r = config(["credentials", "--import", cwd]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/claude key in .*\.n-dx\.local\.json is already in the credential store/);
    expect(await readFile(localPath(), "utf-8")).not.toContain(KEY);
    expect(await readFile(storePath, "utf-8")).toBe(before);
    expect((await stat(storePath)).mtimeMs).toBe(mtime);
  }, DEFAULT_TIMEOUT);

  it("never replaces a different stored key without a terminal to confirm, and names both fingerprints", async () => {
    const STORED = "sk-ant-placeholder-stored-9876543210";
    expect(config(["credentials.claude", "--stdin"], STORED).code).toBe(0);
    const before = await storedClaude();
    await seed({ claude: { api_key: KEY } });

    const r = config(["credentials", "--import", cwd]);
    expect(r.code, r.err).toBe(0);
    expect(await storedClaude()).toEqual(before);
    expect(await readFile(localPath(), "utf-8")).toContain(KEY);
    const skipped = r.out.split("\n").find((l) => /Skipped the claude key/.test(l));
    expect(skipped).toContain(`stored fingerprint ${fingerprintOf(STORED)}`);
    expect(skipped).toContain(`fingerprint ${fingerprintOf(KEY)}`);
    for (const text of [r.out, r.err]) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(STORED);
    }
  }, DEFAULT_TIMEOUT);

  it("leaves a git-tracked local file and the store alone, saying the file belongs to the repository", async () => {
    await seed({ google: { api_key: KEY } });
    const git = (args) => spawnSync("git", args, { cwd, stdio: "pipe" });
    git(["init", "-q"]);
    git(["add", "-f", "--", ".n-dx.local.json"]);
    const before = await readFile(localPath(), "utf-8");

    for (const args of [["credentials", "--import", cwd], ["credentials", cwd]]) {
      const r = config(args);
      expect(r.code, r.err).toBe(0);
      expect(r.out).toMatch(/holds an API key \(google\), but the file belongs to the repository/);
      expect(r.out + r.err).not.toContain(KEY);
    }
    expect(await readFile(localPath(), "utf-8")).toBe(before);
    expect(existsSync(join(home, "credentials.json"))).toBe(false);
  }, DEFAULT_TIMEOUT);

  it("removes a key from the file only after the store write succeeded", async () => {
    await seed({ claude: { api_key: KEY } });
    // A file where the ndx home should be: the store cannot be written.
    const blocked = join(root, "blocked");
    await writeFile(blocked, "");
    const r = spawnSync(process.execPath, [CLI_PATH, "config", "credentials", "--import", cwd], {
      env: { ...process.env, NDX_HOME: join(blocked, "home") },
      encoding: "utf-8",
      timeout: DEFAULT_TIMEOUT,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Could not store the claude key; it stays in/);
    expect(await readFile(localPath(), "utf-8")).toContain(KEY);
    expect(r.stdout + r.stderr).not.toContain(KEY);
  }, DEFAULT_TIMEOUT);
});
