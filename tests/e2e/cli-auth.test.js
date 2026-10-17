/**
 * E2E tests for `ndx auth` — on-demand credential verification.
 *
 * The command re-runs the vendor auth preflight (same one as
 * `ndx config llm.vendor`) and reports pass/fail. Tests use a fake vendor
 * binary so no real CLI or network is touched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile, chmod } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { DEFAULT_TIMEOUT } from "./e2e-helpers.js";

const isWin = process.platform === "win32";

/**
 * Create a platform-appropriate fake CLI binary.
 * On Unix: shell script with chmod 755. On Windows: .cmd batch file.
 */
async function writeFakeBinary(filePath, { stdout = "", stderrLine = "", exitCode = 0 } = {}) {
  if (isWin) {
    const cmdPath = filePath + ".cmd";
    const lines = ["@echo off"];
    if (stderrLine) lines.push(`echo ${stderrLine} 1>&2`);
    if (stdout) lines.push(`echo ${stdout}`);
    if (exitCode !== 0) lines.push(`exit /b ${exitCode}`);
    await writeFile(cmdPath, lines.join("\r\n") + "\r\n");
    return cmdPath;
  }
  const lines = ["#!/bin/sh"];
  if (stderrLine) lines.push(`echo '${stderrLine}' 1>&2`);
  if (stdout) lines.push(`echo '${stdout}'`);
  if (exitCode !== 0) lines.push(`exit ${exitCode}`);
  await writeFile(filePath, lines.join("\n") + "\n");
  await chmod(filePath, 0o755);
  return filePath;
}

const CLI_PATH = join(import.meta.dirname, "../../packages/core/cli.js");

/** Run `ndx <args>` capturing stdout/stderr/status (never throws). */
function runNdx(args, env = process.env) {
  const res = spawnSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: DEFAULT_TIMEOUT,
    env,
  });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", status: res.status };
}

/** Set a config value via `ndx config` (throws on failure). */
function setConfig(key, value, dir) {
  execFileSync("node", [CLI_PATH, "config", key, value, dir], {
    encoding: "utf-8",
    timeout: DEFAULT_TIMEOUT,
    // Without stdio, execFileSync routes child stderr to the parent's, so CLI
    // notices from this fixture would print into the vitest report.
    stdio: "pipe",
  });
}

describe("ndx auth", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-auth-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("exits 0 and reports vendor, model, and 'credentials valid' when the claude preflight passes", async () => {
    const fakeClaude = await writeFakeBinary(join(tmpDir, "fake-claude-ok"), {
      stdout: '{"result":"ok"}',
    });
    setConfig("llm.claude.cli_path", fakeClaude, tmpDir);

    const { stdout, status } = runNdx(["auth", tmpDir]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/credentials valid/i);
    expect(stdout).toContain("vendor: claude");
    expect(stdout).toMatch(/model: \S+/);
  });

  it("exits non-zero with the structured auth-failure guidance when claude credentials are rejected", async () => {
    const fakeClaude = await writeFakeBinary(join(tmpDir, "fake-claude-fail"), {
      stderrLine: "please login",
      exitCode: 9,
    });
    setConfig("llm.claude.cli_path", fakeClaude, tmpDir);

    const { stdout, stderr, status } = runNdx(["auth", tmpDir]);
    expect(status).not.toBe(0);
    expect(stdout).not.toMatch(/credentials valid/i);
    // Canonical, JSON-free guidance — same wording as the runtime error path.
    expect(stderr).toContain("Authentication failed for Claude");
    expect(stderr).toContain("Invalid or expired credentials");
    expect(stderr).toContain("claude logout && claude login");
    expect(stderr).toContain("Verify credentials: ndx auth");
    expect(stderr).not.toContain("Details:");
    expect(stderr).not.toMatch(/"result"|\{"/);
  });

  it("exits non-zero with codex guidance when the codex preflight fails", async () => {
    // Setting llm.vendor runs its own preflight, so start with a passing
    // fake binary, then overwrite it with a failing one and run `ndx auth`
    // — simulating credentials that expired after the vendor was selected.
    const basePath = join(tmpDir, "fake-codex");
    const fakeCodex = await writeFakeBinary(basePath, { stdout: "ok" });
    setConfig("llm.codex.cli_path", fakeCodex, tmpDir);
    setConfig("llm.vendor", "codex", tmpDir);
    await writeFakeBinary(basePath, { stderrLine: "not logged in", exitCode: 7 });

    const { stderr, status } = runNdx(["auth", tmpDir]);
    expect(status).not.toBe(0);
    expect(stderr).toContain("Authentication failed for Codex");
    expect(stderr).toContain("codex logout && codex login");
    expect(stderr).toContain("Verify credentials: ndx auth");
  });

  describe("Google preflight: llm.google.apiKeyEnv is credential routing", () => {
    // Which variable is sent as the Google key is the user's choice: a shared
    // `.n-dx.json` apiKeyEnv applies only once the repository is trusted. A
    // preloaded fetch stub records each request's host and whether it carried
    // the sentinel key, so nothing leaves the machine and the key is never
    // printed.
    const SENTINEL_VAR = "NDX_TEST_SENTINEL_GOOGLE_KEY";
    const SENTINEL_KEY = "AIza" + "x".repeat(35);
    let requestsPath;
    let env;

    beforeEach(async () => {
      requestsPath = join(tmpDir, "requests.jsonl");
      const stubPath = join(tmpDir, "fetch-stub.mjs");
      await writeFile(
        stubPath,
        [
          'import { appendFileSync } from "node:fs";',
          "globalThis.fetch = async (url, init = {}) => {",
          "  const carriesKey = init.headers?.['x-goog-api-key'] === process.env.SENTINEL_KEY;",
          "  appendFileSync(process.env.REQUESTS_PATH, JSON.stringify({ host: new URL(String(url)).host, carriesKey }) + '\\n');",
          "  return new Response('{}', { status: 200 });",
          "};",
        ].join("\n") + "\n",
      );
      env = {
        ...process.env,
        NDX_HOME: join(tmpDir, "ndx-home"),
        NODE_OPTIONS: `--import=${pathToFileURL(stubPath).href}`,
        REQUESTS_PATH: requestsPath,
        SENTINEL_KEY,
        [SENTINEL_VAR]: SENTINEL_KEY,
      };
      delete env.GEMINI_API_KEY;
      delete env.NDX_TEST_GOOGLE_PREFLIGHT;
    });

    async function requests() {
      const raw = await readFile(requestsPath, "utf-8").catch((err) => {
        if (err.code === "ENOENT") return "";
        throw err;
      });
      return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    }

    async function writeConfigs(shared, local) {
      await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify(shared, null, 2) + "\n");
      if (local) {
        await writeFile(join(tmpDir, ".n-dx.local.json"), JSON.stringify(local, null, 2) + "\n");
      }
    }

    it("ndx auth does not send the variable an untrusted repository names", async () => {
      await writeConfigs({ llm: { vendor: "google", google: { apiKeyEnv: SENTINEL_VAR } } });

      const { stderr, status } = runNdx(["auth", tmpDir], env);

      expect(await requests()).toEqual([]);
      expect(status).not.toBe(0);
      expect(stderr).toContain("No API key configured for Google");
      expect(stderr).toContain("export GEMINI_API_KEY=");
    });

    it("ndx config llm.vendor google does not send the variable an untrusted repository names", async () => {
      await writeConfigs({ llm: { google: { apiKeyEnv: SENTINEL_VAR } } });

      runNdx(["config", "llm.vendor", "google", tmpDir, "--soft-preflight"], env);

      expect(await requests()).toEqual([]);
    });

    it("ndx auth uses an apiKeyEnv from .n-dx.local.json", async () => {
      await writeConfigs(
        { llm: { vendor: "google" } },
        { llm: { google: { apiKeyEnv: SENTINEL_VAR } } },
      );

      const { stdout, status } = runNdx(["auth", tmpDir], env);

      expect(await requests()).toEqual([{ host: "generativelanguage.googleapis.com", carriesKey: true }]);
      expect(status).toBe(0);
      expect(stdout).toMatch(/credentials valid/i);
    });
  });

  describe("vendor CLI binary: a shared cli_path applies only once the repository is trusted", () => {
    // Each fake binary records that it ran by creating its own marker file.
    // The PATH ones stand in for the real `claude` / `codex`, so the fallback
    // never launches a CLI installed on the machine.
    let env;
    let pathDir;

    async function writeMarkerBinary(filePath, marker) {
      if (isWin) {
        const cmdPath = filePath + ".cmd";
        await writeFile(cmdPath, `@echo off\r\necho ran> "${marker}"\r\necho {"result":"ok"}\r\n`);
        return cmdPath;
      }
      await writeFile(filePath, `#!/bin/sh\necho ran > '${marker}'\necho '{"result":"ok"}'\n`);
      await chmod(filePath, 0o755);
      return filePath;
    }

    const ran = (name) => readFile(join(tmpDir, `${name}.ran`), "utf-8").then(() => true, () => false);

    beforeEach(async () => {
      pathDir = join(tmpDir, "path-bin");
      await mkdir(pathDir);
      await writeMarkerBinary(join(pathDir, "claude"), join(tmpDir, "path-claude.ran"));
      await writeMarkerBinary(join(pathDir, "codex"), join(tmpDir, "path-codex.ran"));
      env = {
        ...process.env,
        NDX_HOME: join(tmpDir, "ndx-home"),
        PATH: `${pathDir}${delimiter}${process.env.PATH ?? ""}`,
      };
    });

    async function repoBinary(name) {
      return writeMarkerBinary(join(tmpDir, name), join(tmpDir, `${name}.ran`));
    }

    async function writeConfigs(shared, local) {
      await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify(shared) + "\n");
      if (local) await writeFile(join(tmpDir, ".n-dx.local.json"), JSON.stringify(local) + "\n");
    }

    it.each([
      ["llm.claude.cli_path", (bin) => ({ llm: { vendor: "claude", claude: { cli_path: bin } } }), "path-claude"],
      ["claude.cli_path", (bin) => ({ llm: { vendor: "claude" }, claude: { cli_path: bin } }), "path-claude"],
      ["llm.codex.cli_path", (bin) => ({ llm: { vendor: "codex", codex: { cli_path: bin } } }), "path-codex"],
    ])("ndx auth does not run an untrusted repository's %s", async (field, shared, fallback) => {
      await writeConfigs(shared(await repoBinary("repo-cli")));

      const { stderr } = runNdx(["auth", tmpDir], env);

      expect(await ran("repo-cli")).toBe(false);
      expect(await ran(fallback)).toBe(true);
      expect(stderr).toContain(field);
    });

    it("ndx config llm.vendor does not run an untrusted repository's cli_path", async () => {
      await writeConfigs({ llm: { codex: { cli_path: await repoBinary("repo-cli") } } });

      runNdx(["config", "llm.vendor", "codex", tmpDir, "--soft-preflight"], env);

      expect(await ran("repo-cli")).toBe(false);
      expect(await ran("path-codex")).toBe(true);
    });

    it("ndx auth runs the cli_path in .n-dx.local.json", async () => {
      await writeConfigs({ llm: { vendor: "claude" } }, { llm: { claude: { cli_path: await repoBinary("local-cli") } } });

      const { stdout, status } = runNdx(["auth", tmpDir], env);

      expect(status).toBe(0);
      expect(stdout).toMatch(/credentials valid/i);
      expect(await ran("local-cli")).toBe(true);
      expect(await ran("path-claude")).toBe(false);
    });
  });

  it("appears in 'ndx --help' output", () => {
    const { stdout, status } = runNdx(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/auth \[dir\]\s+Verify LLM provider credentials/);
  });

  it("shows detailed help for 'ndx auth --help'", () => {
    const { stdout, status } = runNdx(["auth", "--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("verify LLM provider credentials");
    expect(stdout).toContain("ndx auth [dir]");
  });
});
