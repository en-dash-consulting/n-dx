import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI_PATH = join(import.meta.dirname, "../../cli.js");

function run(args, opts = {}) {
  return execFileSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: 20000,
    stdio: "pipe",
    ...opts,
  });
}

function runFail(args, opts = {}) {
  try {
    run(args, opts);
    throw new Error("Expected command to fail");
  } catch (err) {
    if (err.message === "Expected command to fail") throw err;
    return {
      stdout: err.stdout,
      stderr: err.stderr,
      status: err.status,
    };
  }
}

describe("n-dx init provider selection", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-init-e2e-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("prompts with codex and claude options only", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-prompt-"));
    try {
      await writeFile(
        join(binDir, "codex"),
        "#!/bin/sh\n" +
          "echo ok\n",
      );
      await chmod(join(binDir, "codex"), 0o755);

      const output = run(["init", tmpDir], {
        input: "1\n",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
      });
      expect(output).toContain("n-dx init");
      expect(output.indexOf("n-dx init")).toBeLessThan(output.indexOf("Select active LLM provider:"));
      expect(output).toContain("Select active LLM provider:");
      expect(output).toContain("1) codex");
      expect(output).toContain("2) claude");
      expect(output).toContain("llm.vendor = codex");
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });

  it("persists selected provider to project settings", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-persist-"));
    try {
      await writeFile(
        join(binDir, "claude"),
        "#!/bin/sh\n" +
          "echo '{\"result\":\"ok\"}'\n",
      );
      await chmod(join(binDir, "claude"), 0o755);

      run(["init", tmpDir], {
        input: "2\n",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
      });
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
    const ndxConfig = JSON.parse(await readFile(join(tmpDir, ".n-dx.json"), "utf-8"));
    expect(ndxConfig.llm.vendor).toBe("claude");
  });

  it("persists both providers through config get pathway", async () => {
    const cases = [
      {
        provider: "codex",
        script: "#!/bin/sh\n" +
          "echo ok\n",
      },
      {
        provider: "claude",
        script: "#!/bin/sh\n" +
          "echo '{\"result\":\"ok\"}'\n",
      },
    ];

    for (const { provider, script } of cases) {
      const projectDir = await mkdtemp(join(tmpdir(), `ndx-init-${provider}-`));
      const binDir = await mkdtemp(join(tmpdir(), `ndx-init-bin-${provider}-`));
      try {
        await writeFile(join(binDir, provider), script);
        await chmod(join(binDir, provider), 0o755);

        run(["init", `--provider=${provider}`, projectDir], {
          env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH ?? ""}`,
          },
        });

        const configured = run(["config", "llm.vendor", projectDir]).trim();
        expect(configured).toBe(provider);
      } finally {
        await rm(binDir, { recursive: true, force: true });
        await rm(projectDir, { recursive: true, force: true });
      }
    }
  });

  it("exits non-zero with clear message when selection is cancelled", () => {
    const result = runFail(["init", tmpDir], { input: "\n" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Init cancelled: no provider selected");
  });

  it("suppresses init banner in non-interactive mode", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-noninteractive-"));
    try {
      await writeFile(
        join(binDir, "codex"),
        "#!/bin/sh\n" +
          "echo ok\n",
      );
      await chmod(join(binDir, "codex"), 0o755);

      const output = run(["init", "--provider=codex", tmpDir], {
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
      });

      expect(output).toContain("llm.vendor = codex");
      expect(output).not.toContain("n-dx init");
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  });

  describe("provider auth preflight during init", () => {
    function pathEnvWith(...dirs) {
      return {
        ...process.env,
        PATH: `${dirs.join(":")}:${process.env.PATH ?? ""}`,
      };
    }

    it("completes codex init when authenticated and does not show login prompt", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-codex-ok-"));
      try {
        await writeFile(
          join(binDir, "codex"),
          "#!/bin/sh\n" +
            "echo \"$@\" > \"$0.args\"\n" +
            "echo ok\n",
        );
        await chmod(join(binDir, "codex"), 0o755);

        const output = run(
          ["init", "--provider=codex", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(output).toContain("llm.vendor = codex");
        expect(output).not.toContain("Next step: run");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("prompts codex login command when codex auth is missing", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-codex-fail-"));
      try {
        await writeFile(
          join(binDir, "codex"),
          "#!/bin/sh\n" +
            "echo 'not logged in' 1>&2\n" +
            "exit 7\n",
        );
        await chmod(join(binDir, "codex"), 0o755);

        const result = runFail(
          ["init", "--provider=codex", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("Provider auth preflight failed for \"codex\"");
        expect(result.stderr).toContain("Next step: run 'codex login'");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("completes claude init when authenticated and does not show login prompt", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-claude-ok-"));
      try {
        await writeFile(
          join(binDir, "claude"),
          "#!/bin/sh\n" +
            "echo \"$@\" > \"$0.args\"\n" +
            "echo '{\"result\":\"ok\"}'\n",
        );
        await chmod(join(binDir, "claude"), 0o755);

        const output = run(
          ["init", "--provider=claude", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(output).toContain("llm.vendor = claude");
        expect(output).not.toContain("Next step: run");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });

    it("prompts claude login command when claude auth is missing", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "ndx-init-bin-claude-fail-"));
      try {
        await writeFile(
          join(binDir, "claude"),
          "#!/bin/sh\n" +
            "echo 'please login' 1>&2\n" +
            "exit 9\n",
        );
        await chmod(join(binDir, "claude"), 0o755);

        const result = runFail(
          ["init", "--provider=claude", tmpDir],
          { env: pathEnvWith(binDir) },
        );

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("Provider auth preflight failed for \"claude\"");
        expect(result.stderr).toContain("Next step: run 'claude login'");
      } finally {
        await rm(binDir, { recursive: true, force: true });
      }
    });
  });
});
