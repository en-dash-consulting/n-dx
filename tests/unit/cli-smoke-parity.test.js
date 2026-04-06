import { describe, it, expect } from "vitest";
import {
  normalizeText,
  compareArtifacts,
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
});
