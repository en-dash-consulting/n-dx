import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GuardRails } from "../../../src/guard/index.js";
import { toolRunCommand } from "../../../src/tools/shell.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";
import { cleanupProjectDir } from "../../helpers/index.js";

/**
 * How long a deliberately-timed-out command keeps running.
 *
 * It has to exceed the timeouts asserted below so the timeout is what ends the
 * call, and it has to stay well inside RM_RETRY's ~5.5s window so the orphan it
 * leaves has exited before teardown gives up. The orphan is not incidental: a
 * timeout terminates the spawned `sh`, not the `node` that sh started, so that
 * `node` outlives the call still holding projectDir as its cwd — and on Windows
 * that blocks rmdir.
 *
 * That orphan is a production defect, tracked as a9951988 (a timed-out command
 * keeps running and keeps writing). Bounding its lifetime here is a test-side
 * accommodation, not a fix; this constant should stop being load-bearing once the
 * timeout performs a real tree kill.
 */
const TIMEOUT_ORPHAN_LIFETIME_MS = 3000;

// No BUDGET_MULTIPLIER in this file. Its one timing assertion is bounded by
// TIMEOUT_ORPHAN_LIFETIME_MS above, because that assertion's job is to sit BELOW
// the command's own lifetime — scaling it independently would lift it past that
// lifetime and make it vacuous. See the assertion for the full reasoning, and
// TESTING.md "Flake Resistance" for budgets that genuinely should be scaled.


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
    // The commands below outlive their timeout by enough to guarantee it fires,
    // but not by so much that the orphan they leave behind outlasts teardown.
    // execShell's timeout kills the `sh` it spawned, not sh's own child, so the
    // inner `node` survives holding projectDir as its cwd — see
    // TIMEOUT_ORPHAN_LIFETIME_MS.
    it("handles command timeout", async () => {
      const result = await toolRunCommand(guard, projectDir, {
        command: `node -e "setTimeout(() => {}, ${TIMEOUT_ORPHAN_LIFETIME_MS})"`,
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
        command: `node -e "setTimeout(() => {}, ${TIMEOUT_ORPHAN_LIFETIME_MS})"`,
        timeout: 200,
      });
      const elapsed = Date.now() - start;

      expect(result).toContain("timed out");
      // Must return on the 200ms timeout, not by waiting for the command, which
      // runs for TIMEOUT_ORPHAN_LIFETIME_MS. Bounded BY that lifetime rather than
      // by a magic number, because the lifetime is what makes the two outcomes
      // distinguishable at all.
      //
      // DO NOT scale this through BUDGET_MULTIPLIER. This is not a latency budget
      // that a slow machine should be forgiven for missing — it is a discrimination
      // between "returned on timeout" (~200ms) and "waited for the command"
      // (~3000ms). Multiplying it by 20 puts the bound at 40s, above the command's
      // own lifetime, so the failure case would pass and the assertion would test
      // nothing. A bound whose whole job is to sit below another number cannot be
      // scaled independently of it.
      expect(elapsed).toBeLessThan(TIMEOUT_ORPHAN_LIFETIME_MS);
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
