import { describe, it, expect } from "vitest";
import {
  normalizeText,
  extractJsonPayload,
  parseJsonPayload,
  compareArtifacts,
  collectSmokeArtifact,
  shouldUseShellForCliCommand,
} from "../../scripts/cli-smoke-parity.mjs";

function createDeterministicSmokeRunner({ incompleteVersionJson = false, statusTitle = "Test Project" } = {}) {
  return async function executeCli(args) {
    const key = JSON.stringify(args);
    switch (key) {
      case JSON.stringify(["version"]):
        return { exitCode: 0, stdout: "0.2.1\n", stderr: "" };
      case JSON.stringify(["version", "--json"]):
        return {
          exitCode: 0,
          stdout: incompleteVersionJson
            ? [
              "Debugger attached.",
              "{\"version\":\"0.2.1\"",
            ].join("\n")
            : [
              "Debugger attached.",
              "(node:12345) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.",
              "(Use `node --trace-deprecation ...` to show where the warning was created)",
              "{\"version\":\"0.2.1\"}",
              "Waiting for the debugger to disconnect...",
            ].join("\n"),
          stderr: "",
        };
      case JSON.stringify(["foobar"]):
        return { exitCode: 1, stdout: "", stderr: "Error: Unknown command: foobar\nHint:\n" };
      case JSON.stringify(["statis"]):
        return { exitCode: 1, stdout: "", stderr: "Error: Unknown command: statis\nDid you mean status\n" };
      case JSON.stringify(["help", "rex"]):
        return { exitCode: 0, stdout: "Rex — available commands\nvalidate\nrex <command> --help\n", stderr: "" };
      case JSON.stringify(["help", "plan"]):
        return { exitCode: 0, stdout: "ndx plan\nUSAGE\nEXAMPLES\nSee also:\n", stderr: "" };
      default:
        if (args[0] === "status" && args[1] === "--format=json") {
          return {
            exitCode: 0,
            stdout: [
              "Debugger attached.",
              JSON.stringify({
                schema: "rex/v1",
                title: statusTitle,
                items: [
                  {
                    id: "epic-1",
                    level: "epic",
                    title: "Test Epic",
                    status: "pending",
                    priority: "medium",
                    children: [
                      {
                        id: "task-1",
                        level: "task",
                        title: "Test Task",
                        status: "completed",
                        priority: "medium",
                        children: [],
                      },
                      {
                        id: "task-2",
                        level: "task",
                        title: "Another Task",
                        status: "pending",
                        priority: "low",
                        children: [],
                      },
                    ],
                  },
                ],
              }),
              "Waiting for the debugger to disconnect...",
            ].join("\n"),
            stderr: "",
          };
        }
        if (args[0] === "status") {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `Error: Missing .rex in ${args[1]}\nHint: Run 'ndx init ${args[1]}' to set up the project.\n`,
          };
        }
        throw new Error(`Unhandled smoke args: ${key}`);
    }
  };
}

describe("cli smoke parity helpers", () => {
  it("uses shell semantics for Windows command shims only", () => {
    expect(shouldUseShellForCliCommand("ndx.cmd", "win32")).toBe(true);
    expect(shouldUseShellForCliCommand("C:/tools/ndx.BAT", "win32")).toBe(true);
    expect(shouldUseShellForCliCommand("ndx.exe", "win32")).toBe(false);
    expect(shouldUseShellForCliCommand("ndx", "darwin")).toBe(false);
  });

  it("normalizes line endings, slashes, and known placeholder paths", () => {
    const text = "C:\\tmp\\case\\project\r\n/root/app/file.js  \r\n";
    const normalized = normalizeText(text, [
      ["C:\\tmp\\case", "<TMPDIR>"],
      ["/root/app", "<ROOT>"],
    ]);
    expect(normalized).toBe("<TMPDIR>/project\n<ROOT>/file.js");
  });

  it("strips known Node DEP0040 runtime warning noise before comparing output", () => {
    const text = [
      "(node:12345) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.",
      "(Use `node --trace-deprecation ...` to show where the warning was created)",
      "Error: Unknown command: statis",
      "Hint: Did you mean 'ndx status'?",
      "",
    ].join("\n");

    expect(normalizeText(text)).toBe(
      "Error: Unknown command: statis\nHint: Did you mean 'ndx status'?",
    );
  });

  it("extracts a JSON payload from warning-prefixed mixed stdout", () => {
    const text = [
      "Debugger attached.",
      "(node:12345) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.",
      "(Use `node --trace-deprecation ...` to show where the warning was created)",
      "{\"version\":\"0.2.1\"}",
      "Waiting for the debugger to disconnect...",
    ].join("\n");

    expect(extractJsonPayload(text)).toEqual({
      payload: "{\"version\":\"0.2.1\"}",
      normalized: "Debugger attached.\n{\"version\":\"0.2.1\"}\nWaiting for the debugger to disconnect...",
      hadNoise: true,
      complete: true,
    });
    expect(parseJsonPayload(text, "version-json")).toEqual({ version: "0.2.1" });
  });

  it("classifies incomplete JSON payloads during collection", async () => {
    await expect(
      collectSmokeArtifact({
        executeCli: createDeterministicSmokeRunner({ incompleteVersionJson: true }),
      }),
    ).rejects.toThrow(
      "CLI smoke collect failed at json-extract for version-json: stdout ended before a complete JSON payload was emitted",
    );
  });

  it("accepts matching parity artifacts with stable projected JSON", async () => {
    const { sequence } = await collectSmokeArtifact({
      executeCli: createDeterministicSmokeRunner(),
    });
    const artifact = {
      sequence,
      cases: [
        {
          id: "version-text",
          exitCode: 0,
          stdoutNormalized: "0.2.1",
          stderrNormalized: "",
          comparable: { stdout: "0.2.1", stderr: "" },
        },
        {
          id: "version-json",
          exitCode: 0,
          stdoutNormalized: "{\"version\":\"0.2.1\"}",
          stderrNormalized: "",
          comparable: { stdoutJson: { version: "0.2.1" } },
        },
        {
          id: "unknown-command",
          exitCode: 1,
          stdoutNormalized: "",
          stderrNormalized: "Error: Unknown command: foobar\nHint:",
          comparable: { stderr: "Error: Unknown command: foobar\nHint:" },
        },
        {
          id: "typo-suggestion",
          exitCode: 1,
          stdoutNormalized: "",
          stderrNormalized: "Error: Unknown command: statis\nDid you mean status",
          comparable: { stderr: "Error: Unknown command: statis\nDid you mean status" },
        },
        {
          id: "help-rex",
          exitCode: 0,
          stdoutNormalized: "Rex — available commands\nvalidate\nrex <command> --help",
          stderrNormalized: "",
          comparable: { stdout: "Rex — available commands\nvalidate\nrex <command> --help" },
        },
        {
          id: "plan-help",
          exitCode: 0,
          stdoutNormalized: "ndx plan\nUSAGE\nEXAMPLES\nSee also:",
          stderrNormalized: "",
          comparable: { stdout: "ndx plan\nUSAGE\nEXAMPLES\nSee also:" },
        },
        {
          id: "status-missing-rex",
          exitCode: 1,
          stdoutNormalized: "",
          stderrNormalized: "Missing .rex\nHint: ndx init <TMPDIR>",
          comparable: { stderr: "Missing .rex\nHint: ndx init <TMPDIR>" },
        },
        {
          id: "status-json",
          exitCode: 0,
          stdoutNormalized: "{\"schema\":\"rex/v1\"}",
          stderrNormalized: "",
          comparable: {
            stdoutJson: {
              schema: "rex/v1",
              title: "Test Project",
              items: [
                {
                  id: "epic-1",
                  level: "epic",
                  title: "Test Epic",
                  status: "pending",
                  priority: "medium",
                  children: [
                    {
                      id: "task-1",
                      level: "task",
                      title: "Test Task",
                      status: "completed",
                      priority: "medium",
                      children: [],
                    },
                    {
                      id: "task-2",
                      level: "task",
                      title: "Another Task",
                      status: "pending",
                      priority: "low",
                      children: [],
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    };

    expect(compareArtifacts(artifact, structuredClone(artifact))).toEqual([]);
  });

  it("reports parity mismatches and contract regressions", () => {
    const macArtifact = {
      sequence: [
        {
          id: "version-text",
          fixture: "none",
          args: ["version"],
          expectedExitCode: 0,
          expected: { stdoutExact: "0.2.1" },
        },
      ],
      cases: [
        {
          id: "version-text",
          exitCode: 0,
          stdoutNormalized: "0.2.1",
          stderrNormalized: "",
          comparable: { stdout: "0.2.1", stderr: "" },
        },
      ],
    };
    const windowsArtifact = {
      sequence: [
        {
          id: "version-text",
          fixture: "none",
          args: ["version"],
          expectedExitCode: 0,
          expected: { stdoutExact: "0.2.1" },
        },
      ],
      cases: [
        {
          id: "version-text",
          exitCode: 1,
          stdoutNormalized: "broken",
          stderrNormalized: "",
          comparable: { stdout: "broken", stderr: "" },
        },
      ],
    };

    const issues = compareArtifacts(macArtifact, windowsArtifact);
    expect(issues.some((issue) => issue.includes("exit code"))).toBe(true);
    expect(issues.some((issue) => issue.includes("parity:version-text.comparable.stdout differs"))).toBe(true);
  });

  it("ignores known runtime warning noise while still catching real CLI parity drift", async () => {
    const { sequence } = await collectSmokeArtifact({
      executeCli: createDeterministicSmokeRunner(),
    });
    const warning = [
      "(node:11111) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.",
      "(Use `node --trace-deprecation ...` to show where the warning was created)",
    ].join("\n");

    const macArtifact = {
      sequence,
      cases: [
        {
          id: "version-text",
          exitCode: 0,
          stdoutNormalized: "0.2.1",
          stderrNormalized: "",
          comparable: { stdout: "0.2.1", stderr: "" },
        },
        {
          id: "version-json",
          exitCode: 0,
          stdoutNormalized: "{\"version\":\"0.2.1\"}",
          stderrNormalized: "",
          comparable: { stdoutJson: { version: "0.2.1" } },
        },
        {
          id: "unknown-command",
          exitCode: 1,
          stdoutNormalized: "",
          stderrNormalized: "Error: Unknown command: foobar\nHint: Run 'ndx --help' to see available commands, or 'ndx help <keyword>' to search.",
          comparable: {
            stderr: "Error: Unknown command: foobar\nHint: Run 'ndx --help' to see available commands, or 'ndx help <keyword>' to search.",
          },
        },
        {
          id: "typo-suggestion",
          exitCode: 1,
          stdoutNormalized: "",
          stderrNormalized: "Error: Unknown command: statis\nHint: Did you mean 'ndx status'?",
          comparable: { stderr: "Error: Unknown command: statis\nHint: Did you mean 'ndx status'?" },
        },
        {
          id: "help-rex",
          exitCode: 0,
          stdoutNormalized: "Rex — available commands\nvalidate\nrex <command> --help",
          stderrNormalized: "",
          comparable: { stdout: "Rex — available commands\nvalidate\nrex <command> --help" },
        },
        {
          id: "plan-help",
          exitCode: 0,
          stdoutNormalized: "ndx plan\nUSAGE\nEXAMPLES\nSee also:",
          stderrNormalized: "",
          comparable: { stdout: "ndx plan\nUSAGE\nEXAMPLES\nSee also:" },
        },
        {
          id: "status-missing-rex",
          exitCode: 1,
          stdoutNormalized: "",
          stderrNormalized: "Error: Missing .rex in <TMPDIR>\nHint: Run 'ndx init <TMPDIR>' to set up the project.",
          comparable: {
            stderr: "Error: Missing .rex in <TMPDIR>\nHint: Run 'ndx init <TMPDIR>' to set up the project.",
          },
        },
        {
          id: "status-json",
          exitCode: 0,
          stdoutNormalized: "{\"schema\":\"rex/v1\"}",
          stderrNormalized: "",
          comparable: {
            stdoutJson: {
              schema: "rex/v1",
              title: "Test Project",
              items: [
                {
                  id: "epic-1",
                  level: "epic",
                  title: "Test Epic",
                  status: "pending",
                  priority: "medium",
                  children: [
                    {
                      id: "task-1",
                      level: "task",
                      title: "Test Task",
                      status: "completed",
                      priority: "medium",
                      children: [],
                    },
                    {
                      id: "task-2",
                      level: "task",
                      title: "Another Task",
                      status: "pending",
                      priority: "low",
                      children: [],
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    };
    const windowsArtifact = structuredClone(macArtifact);
    const windowsUnknown = windowsArtifact.cases.find((entry) => entry.id === "unknown-command");
    windowsUnknown.stderrNormalized = `${warning}\n${windowsUnknown.stderrNormalized}`;
    windowsUnknown.comparable = {
      stderr: normalizeText(windowsUnknown.stderrNormalized),
    };

    expect(compareArtifacts(macArtifact, windowsArtifact)).toEqual([]);
  });

  it("collects only deterministic contract fields when using an installed cli runner", async () => {
    const artifact = await collectSmokeArtifact({
      executeCli: createDeterministicSmokeRunner(),
    });

    const versionJsonCase = artifact.cases.find((entry) => entry.id === "version-json");
    const statusJsonCase = artifact.cases.find((entry) => entry.id === "status-json");
    const typoCase = artifact.cases.find((entry) => entry.id === "typo-suggestion");

    expect(versionJsonCase.comparable).toEqual({ stdoutJson: { version: "0.2.1" } });
    expect(statusJsonCase.comparable).toEqual({
      stdoutJson: {
        schema: "rex/v1",
        title: "Test Project",
        items: [
          {
            id: "epic-1",
            level: "epic",
            title: "Test Epic",
            status: "pending",
            priority: "medium",
            children: [
              {
                id: "task-1",
                level: "task",
                title: "Test Task",
                status: "completed",
                priority: "medium",
                children: [],
              },
              {
                id: "task-2",
                level: "task",
                title: "Another Task",
                status: "pending",
                priority: "low",
                children: [],
              },
            ],
          },
        ],
      },
    });
    expect(typoCase).not.toHaveProperty("stdout");
    expect(typoCase).not.toHaveProperty("stderr");
    expect(artifact.sequence).toEqual([
      {
        id: "version-text",
        fixture: "none",
        args: ["version"],
        expectedExitCode: 0,
        expected: { stdoutExact: "0.2.1" },
      },
      {
        id: "version-json",
        fixture: "none",
        args: ["version", "--json"],
        expectedExitCode: 0,
        expected: { stdoutJson: { version: "0.2.1" } },
      },
      {
        id: "unknown-command",
        fixture: "none",
        args: ["foobar"],
        expectedExitCode: 1,
        expected: { stderrIncludes: ["Error: Unknown command: foobar", "Hint:"] },
      },
      {
        id: "typo-suggestion",
        fixture: "none",
        args: ["statis"],
        expectedExitCode: 1,
        expected: { stderrIncludes: ["Error: Unknown command: statis", "Did you mean", "status"] },
      },
      {
        id: "help-rex",
        fixture: "none",
        args: ["help", "rex"],
        expectedExitCode: 0,
        expected: { stdoutIncludes: ["Rex — available commands", "validate", "rex <command> --help"] },
      },
      {
        id: "plan-help",
        fixture: "none",
        args: ["help", "plan"],
        expectedExitCode: 0,
        expected: { stdoutIncludes: ["ndx plan", "USAGE", "EXAMPLES", "See also:"] },
      },
      {
        id: "status-missing-rex",
        fixture: "empty",
        args: ["status", "<TMPDIR>"],
        expectedExitCode: 1,
        expected: { stderrIncludes: ["Missing", ".rex", "Hint:", "ndx init"] },
      },
      {
        id: "status-json",
        fixture: "rex",
        args: ["status", "--format=json", "<TMPDIR>"],
        expectedExitCode: 0,
        expected: {
          stdoutJson: {
            schema: "rex/v1",
            title: "Test Project",
            items: [
              {
                id: "epic-1",
                level: "epic",
                title: "Test Epic",
                status: "pending",
                priority: "medium",
                children: [
                  {
                    id: "task-1",
                    level: "task",
                    title: "Test Task",
                    status: "completed",
                    priority: "medium",
                    children: [],
                  },
                  {
                    id: "task-2",
                    level: "task",
                    title: "Another Task",
                    status: "pending",
                    priority: "low",
                    children: [],
                  },
                ],
              },
            ],
          },
        },
      },
    ]);
  });

  it("produces the same canonical artifact shape across repeat runs", async () => {
    const executeCli = createDeterministicSmokeRunner();
    const first = await collectSmokeArtifact({ executeCli });
    const second = await collectSmokeArtifact({ executeCli });

    expect(first.sequence).toEqual(second.sequence);
    expect(compareArtifacts(first, second)).toEqual([]);
  });

  it("reports clear comparable diffs when platform outputs diverge", async () => {
    const macArtifact = await collectSmokeArtifact({
      executeCli: createDeterministicSmokeRunner(),
    });
    const windowsArtifact = await collectSmokeArtifact({
      executeCli: createDeterministicSmokeRunner({ statusTitle: "Windows Project" }),
    });

    expect(compareArtifacts(macArtifact, windowsArtifact)).toContain(
      'windows:status-json.stdoutJson.title differs (expected="Test Project" actual="Windows Project")',
    );
    expect(compareArtifacts(macArtifact, windowsArtifact)).toContain(
      'parity:status-json.comparable.stdoutJson.title differs (macos="Test Project" windows="Windows Project")',
    );
  });
});
