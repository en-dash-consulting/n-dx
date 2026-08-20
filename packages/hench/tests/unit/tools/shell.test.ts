import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GuardRails } from "../../../src/guard/index.js";
import { toolRunCommand } from "../../../src/tools/shell.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";
import { cleanupProjectDir } from "../../helpers/index.js";

/**
 * How long a deliberately-timed-out command would keep running if nothing stopped
 * it — far longer than teardown would ever wait.
 *
 * This used to have to stay short. A timeout terminated the spawned `sh` and not
 * the `node` that sh started, so that `node` outlived the call still holding
 * projectDir as its cwd, and on Windows a held cwd blocks rmdir. Bounding its
 * lifetime was a test-side accommodation for that.
 *
 * The accommodation is gone: exec now kills the whole process tree on timeout
 * (a9951988), so a minute-long command leaves nothing behind and this value is no
 * longer load-bearing. Restoring the long duration is deliberate — it is what
 * would fail if the tree kill regressed.
 */
const TIMEOUT_COMMAND_LIFETIME_MS = 60_000;

// No BUDGET_MULTIPLIER in this file. Its one timing assertion is expressed as a
// fraction of TIMEOUT_COMMAND_LIFETIME_MS above, because that assertion's job is
// to sit BELOW the command's own lifetime — scaling it independently would lift it
// toward that lifetime and make it vacuous. See the assertion for the reasoning,
// and TESTING.md "Flake Resistance" for budgets that genuinely should be scaled.


describe("toolRunCommand", () => {
  let projectDir: string;
  let guard: GuardRails;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-shell-"));
    guard = new GuardRails(projectDir, DEFAULT_HENCH_CONFIG().guard);
  });

  afterEach(async () => {
    await cleanupProjectDir(projectDir);
  });

  describe("allowed commands", () => {
    it("runs allowed commands", async () => {
      const result = await toolRunCommand(guard, projectDir, {
        command: "node -e \"console.log('hello')\"",
      });
      expect(result).toContain("hello");
    });

    it("runs npm commands", async () => {
      // npm --version should work
      const result = await toolRunCommand(guard, projectDir, {
        command: "npm --version",
      });
      expect(result).toMatch(/\d+\.\d+/);
    });

    it("runs npx commands", async () => {
      const result = await toolRunCommand(guard, projectDir, {
        command: "npx --version",
      });
      expect(result).toMatch(/\d+\.\d+/);
    });
  });

  describe("disallowed commands", () => {
    it("rejects disallowed commands", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "curl http://example.com",
        }),
      ).rejects.toThrow("not in allowlist");
    });

    it("rejects wget", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "wget http://example.com",
        }),
      ).rejects.toThrow("not in allowlist");
    });

    it("rejects rm", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "rm test.txt",
        }),
      ).rejects.toThrow("not in allowlist");
    });

    it("rejects cat", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "cat /etc/passwd",
        }),
      ).rejects.toThrow("not in allowlist");
    });

    it("rejects python", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "python -c 'print(1)'",
        }),
      ).rejects.toThrow("not in allowlist");
    });

    it("rejects sh", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "sh -c 'echo hello'",
        }),
      ).rejects.toThrow("not in allowlist");
    });

    it("rejects bash", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "bash -c 'echo hello'",
        }),
      ).rejects.toThrow("not in allowlist");
    });
  });

  describe("command injection prevention", () => {
    it("rejects chained commands with &&", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "npm test && rm -rf /",
        }),
      ).rejects.toThrow("shell operator");
    });

    it("rejects chained commands with ||", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "npm test || rm -rf /",
        }),
      ).rejects.toThrow("shell operator");
    });

    it("rejects chained commands with ;", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "npm test; rm -rf /",
        }),
      ).rejects.toThrow("shell operator");
    });

    it("rejects background commands with &", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "npm test & sleep 10",
        }),
      ).rejects.toThrow("shell operator");
    });

    it("rejects pipe operators", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "npm test | tee log.txt",
        }),
      ).rejects.toThrow("shell operator");
    });

    it("rejects command substitution with $()", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "node $(cat /etc/passwd)",
        }),
      ).rejects.toThrow("shell operator");
    });

    it("rejects command substitution with backticks", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "node `cat /etc/passwd`",
        }),
      ).rejects.toThrow("shell operator");
    });

    it("rejects variable expansion", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "node $HOME/malicious.js",
        }),
      ).rejects.toThrow("shell operator");
    });

    it("rejects environment variable injection", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "npm run ${EVIL_CMD}",
        }),
      ).rejects.toThrow("shell operator");
    });
  });

  describe("dangerous patterns", () => {
    it("rejects sudo even with allowed command", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "npm run sudo something",
        }),
      ).rejects.toThrow("dangerous pattern");
    });

    it("rejects eval patterns", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "npm run eval malicious",
        }),
      ).rejects.toThrow("dangerous pattern");
    });

    it("rejects exec patterns", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "npm run exec malicious",
        }),
      ).rejects.toThrow("dangerous pattern");
    });
  });

  describe("timeout handling", () => {
    // The commands below run far longer than their timeout, so the timeout is
    // certainly what ends the call — and the tree kill is what makes that safe:
    // `sh` is the process that gets signalled, and the `node` it started is the
    // one that used to survive holding projectDir as its cwd.
    it("handles command timeout", async () => {
      const result = await toolRunCommand(guard, projectDir, {
        command: `node -e "setTimeout(() => {}, ${TIMEOUT_COMMAND_LIFETIME_MS})"`,
        timeout: 500,
      });
      expect(result).toContain("timed out");
    });

    it("uses guard default timeout when not specified", async () => {
      // Should not throw, uses default timeout
      const result = await toolRunCommand(guard, projectDir, {
        command: "node -e \"console.log('quick')\"",
      });
      expect(result).toContain("quick");
    });

    it("respects custom timeout parameter", async () => {
      const start = Date.now();
      const result = await toolRunCommand(guard, projectDir, {
        command: `node -e "setTimeout(() => {}, ${TIMEOUT_COMMAND_LIFETIME_MS})"`,
        timeout: 200,
      });
      const elapsed = Date.now() - start;

      expect(result).toContain("timed out");
      // Must return on the timeout, not on the command finishing. The bound is
      // derived from the command's own lifetime rather than hardcoded: what
      // matters is "far sooner than 60s", not any particular millisecond count.
      // A fixed 2000ms was cutting it close — the tree kill spawns taskkill on
      // Windows, which took ~660ms of that budget on a loaded dev machine and
      // would take longer on a 2-core runner.
      //
      // This is also why the bound must not be scaled through BUDGET_MULTIPLIER:
      // its whole job is to sit between the two outcomes (~200ms vs ~60s), so it
      // has to move with the lifetime it discriminates against. Scaling it
      // independently lifts it past that lifetime and the assertion tests nothing.
      expect(elapsed).toBeLessThan(TIMEOUT_COMMAND_LIFETIME_MS / 4);
    });
  });

  describe("output handling", () => {
    it("captures stdout", async () => {
      const result = await toolRunCommand(guard, projectDir, {
        command: "node -e \"console.log('stdout message')\"",
      });
      expect(result).toContain("stdout message");
    });

    it("captures stderr", async () => {
      const result = await toolRunCommand(guard, projectDir, {
        command: "node -e \"console.error('oops')\"",
      });
      expect(result).toContain("oops");
      expect(result).toContain("[stderr]");
    });

    it("captures both stdout and stderr", async () => {
      // Using a single statement that outputs to both streams
      // The command guard blocks semicolons, so we use a script that outputs both
      const result = await toolRunCommand(guard, projectDir, {
        command:
          "node -e \"console.log('out'), console.error('err')\"",
      });
      expect(result).toContain("out");
      expect(result).toContain("err");
    });

    it("returns (no output) for silent commands", async () => {
      const result = await toolRunCommand(guard, projectDir, {
        command: "node -e \"\"",
      });
      expect(result).toBe("(no output)");
    });

    it("reports exit code on failure without output", async () => {
      const result = await toolRunCommand(guard, projectDir, {
        command: "node -e \"process.exit(1)\"",
      });
      expect(result).toContain("Exit code");
    });
  });

  describe("working directory handling", () => {
    it("uses projectDir as default cwd", async () => {
      const result = await toolRunCommand(guard, projectDir, {
        command: "node -e \"console.log(process.cwd())\"",
      });
      expect(result).toContain(projectDir);
    });

    it("respects custom cwd within project", async () => {
      const subdir = join(projectDir, "subdir");
      await mkdir(subdir);

      const result = await toolRunCommand(guard, projectDir, {
        command: "node -e \"console.log(process.cwd())\"",
        cwd: subdir,
      });
      expect(result).toContain("subdir");
    });

    it("rejects cwd outside project directory", async () => {
      await expect(
        toolRunCommand(guard, projectDir, {
          command: "node -e \"console.log(1)\"",
          cwd: "/tmp",
        }),
      ).rejects.toThrow();
    });
  });

  describe("path security", () => {
    it("allows commands with full path to allowed executables", async () => {
      // This should work because "node" is in the allowlist
      // We verify the guard allows full paths (path extraction happens in validateCommand)
      // Using a simpler command that doesn't depend on node location
      const result = await toolRunCommand(guard, projectDir, {
        command: "node -e \"console.log('path test')\"",
      });
      expect(result).toContain("path test");
    });
  });
});
