import { describe, it, expect } from "vitest";
import {
  normalizeText,
  compareArtifacts,
  collectSmokeArtifact,
} from "../../scripts/cli-smoke-parity.mjs";

describe("cli smoke parity helpers", () => {
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

  it("accepts matching parity artifacts with stable projected JSON", () => {
    const artifact = {
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
    expect(issues.some((issue) => issue.includes("parity mismatch"))).toBe(true);
  });

  it("ignores known runtime warning noise while still catching real CLI parity drift", () => {
    const warning = [
      "(node:11111) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.",
      "(Use `node --trace-deprecation ...` to show where the warning was created)",
    ].join("\n");

    const macArtifact = {
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
      async executeCli(args) {
        const key = JSON.stringify(args);
        switch (key) {
          case JSON.stringify(["version"]):
            return { exitCode: 0, stdout: "0.2.1\n", stderr: "" };
          case JSON.stringify(["version", "--json"]):
            return { exitCode: 0, stdout: "{\"version\":\"0.2.1\"}\n", stderr: "" };
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
                stdout: JSON.stringify({
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
                }) + "\n",
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
      },
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
  });
});
