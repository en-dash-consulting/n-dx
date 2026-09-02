import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  normalizeText,
  describeShape,
  extractJsonPayload,
  extractErrorCode,
  extractFailureMetadata,
  parseJsonPayload,
  compareArtifacts,
  validateBaseline,
  collectSmokeArtifact,
  SMOKE_CASES,
  shouldUseShellForCliCommand,
} from "../../scripts/cli-smoke-parity.mjs";

const CORE_VERSION = JSON.parse(
  readFileSync(new URL("../../packages/core/package.json", import.meta.url), "utf-8"),
).version;

const CLI_ERROR_CODES = Object.freeze({
  GENERIC: "NDX_CLI_GENERIC",
  NOT_INITIALIZED: "NDX_CLI_NOT_INITIALIZED",
  UNKNOWN_COMMAND: "NDX_CLI_UNKNOWN_COMMAND",
});

function parseDocumentedCliErrorCodes() {
  const markdown = readFileSync(
    new URL("../../docs/contributing/cli-smoke-parity.md", import.meta.url),
    "utf-8",
  );
  return new Map(
    Array.from(
      markdown.matchAll(/^\|\s*`(NDX_CLI_[A-Z_]+)`\s*\|.*\|\s*(Yes|No)\s*\|.*$/gm),
      ([, code, comparable]) => [code, comparable === "Yes"],
    ),
  );
}

function createDeterministicSmokeRunner({ incompleteVersionJson = false, statusTitle = "Test Project" } = {}) {
  return async function executeCli(args) {
    const key = JSON.stringify(args);
    switch (key) {
      case JSON.stringify(["version"]):
        return { exitCode: 0, stdout: `${CORE_VERSION}\n`, stderr: "" };
      case JSON.stringify(["version", "--json"]):
        return {
          exitCode: 0,
          stdout: incompleteVersionJson
            ? [
              "Debugger attached.",
              `{"version":"${CORE_VERSION}"`,
            ].join("\n")
            : [
              "Debugger attached.",
              "(node:12345) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.",
              "(Use `node --trace-deprecation ...` to show where the warning was created)",
              `{"version":"${CORE_VERSION}"}`,
              "Waiting for the debugger to disconnect...",
            ].join("\n"),
          stderr: "",
        };
      case JSON.stringify(["foobar"]):
        return { exitCode: 1, stdout: "", stderr: `Error: [${CLI_ERROR_CODES.UNKNOWN_COMMAND}] Unknown command: foobar\nHint:\n` };
      case JSON.stringify(["statis"]):
        return { exitCode: 1, stdout: "", stderr: `Error: [${CLI_ERROR_CODES.UNKNOWN_COMMAND}] Unknown command: statis\nDid you mean status\n` };
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
                        id: "task-2",
                        level: "task",
                        title: "Another Task",
                        status: "pending",
                        priority: "low",
                        children: [],
                      },
                      {
                        id: "task-1",
                        level: "task",
                        title: "Test Task",
                        status: "completed",
                        priority: "medium",
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
            stderr: `Error: [${CLI_ERROR_CODES.NOT_INITIALIZED}] Missing .rex in ${args[1]}\nHint: Run 'ndx init ${args[1]}' to set up the project.\n`,
          };
        }
        throw new Error(`Unhandled smoke args: ${key}`);
    }
  };
}

describe("cli smoke parity helpers", () => {
  it("requires every smoke-parity failure code to be documented as cross-platform comparable", () => {
    const documented = parseDocumentedCliErrorCodes();
    const comparableCodes = [...new Set(
      SMOKE_CASES
        .map((smokeCase) => smokeCase.expected?.stderrCode)
        .filter(Boolean),
    )];

    expect(comparableCodes.length).toBeGreaterThan(0);
    for (const code of comparableCodes) {
      expect(documented.get(code), `${code} must be listed as comparable in docs/contributing/cli-smoke-parity.md`).toBe(true);
    }
  });

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
      `Error: [${CLI_ERROR_CODES.UNKNOWN_COMMAND}] Unknown command: statis`,
      "Hint: Did you mean 'ndx status'?",
      "",
    ].join("\n");

    expect(normalizeText(text)).toBe(
      `Error: [${CLI_ERROR_CODES.UNKNOWN_COMMAND}] Unknown command: statis\nHint: Did you mean 'ndx status'?`,
    );
  });

  it("strips known child lifecycle platform warnings before comparing output", () => {
    const text = [
      "[child-lifecycle] process group cleanup is not supported on this platform; falling back to direct child kill",
      CORE_VERSION,
      "",
    ].join("\n");

    expect(normalizeText(text)).toBe(CORE_VERSION);
  });

  it("extracts a JSON payload from warning-prefixed mixed stdout", () => {
    const text = [
      "Debugger attached.",
      "(node:12345) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.",
      "(Use `node --trace-deprecation ...` to show where the warning was created)",
      `{"version":"${CORE_VERSION}"}`,
      "Waiting for the debugger to disconnect...",
    ].join("\n");

    expect(extractJsonPayload(text)).toEqual({
      payload: `{"version":"${CORE_VERSION}"}`,
      normalized: `Debugger attached.\n{"version":"${CORE_VERSION}"}\nWaiting for the debugger to disconnect...`,
      hadNoise: true,
      complete: true,
    });
    expect(parseJsonPayload(text, "version-json")).toEqual({ version: CORE_VERSION });
  });

  it("extracts stable CLI error codes from formatted stderr output", () => {
    expect(
      extractErrorCode(`Error: [${CLI_ERROR_CODES.UNKNOWN_COMMAND}] Unknown command: statis\nHint: Did you mean 'ndx status'?`),
    ).toBe(CLI_ERROR_CODES.UNKNOWN_COMMAND);
    expect(extractErrorCode("Error: plain failure")).toBe(CLI_ERROR_CODES.GENERIC);
  });

  it("extracts normalized failure metadata separately from stderr details", () => {
    expect(
      extractFailureMetadata(
        `Error: [${CLI_ERROR_CODES.NOT_INITIALIZED}] Missing .rex in <TMPDIR>\nHint: Run 'ndx init <TMPDIR>' to set up the project.`,
      ),
    ).toEqual({
      code: CLI_ERROR_CODES.NOT_INITIALIZED,
      detail: "Missing .rex in <TMPDIR>",
    });
    expect(extractFailureMetadata("")).toBeNull();
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
          stdoutNormalized: CORE_VERSION,
          stderrNormalized: "",
          comparable: { stdout: CORE_VERSION, stderr: "" },
        },
        {
          id: "version-json",
          exitCode: 0,
          stdoutNormalized: `{"version":"${CORE_VERSION}"}`,
          stderrNormalized: "",
          comparable: { stdoutJson: { version: CORE_VERSION } },
        },
        {
          id: "unknown-command",
          exitCode: 1,
          stdoutNormalized: "",
          stderrNormalized: `Error: [${CLI_ERROR_CODES.UNKNOWN_COMMAND}] Unknown command: foobar\nHint:`,
          failure: {
            code: CLI_ERROR_CODES.UNKNOWN_COMMAND,
            detail: "Unknown command: foobar",
          },
          comparable: {
            failure: {
              code: CLI_ERROR_CODES.UNKNOWN_COMMAND,
              detail: "Unknown command: foobar",
            },
          },
        },
        {
          id: "typo-suggestion",
          exitCode: 1,
          stdoutNormalized: "",
          stderrNormalized: `Error: [${CLI_ERROR_CODES.UNKNOWN_COMMAND}] Unknown command: statis\nDid you mean status`,
          failure: {
            code: CLI_ERROR_CODES.UNKNOWN_COMMAND,
            detail: "Unknown command: statis",
          },
          comparable: {
            failure: {
              code: CLI_ERROR_CODES.UNKNOWN_COMMAND,
              detail: "Unknown command: statis",
            },
          },
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
          stderrNormalized: `Error: [${CLI_ERROR_CODES.NOT_INITIALIZED}] Missing .rex\nHint: ndx init <TMPDIR>`,
          failure: {
            code: CLI_ERROR_CODES.NOT_INITIALIZED,
            detail: "Missing .rex",
          },
          comparable: {
            failure: {
              code: CLI_ERROR_CODES.NOT_INITIALIZED,
              detail: "Missing .rex",
            },
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
                      id: "task-2",
                      level: "task",
                      title: "Another Task",
                      status: "pending",
                      priority: "low",
                      children: [],
                    },
                    {
                      id: "task-1",
                      level: "task",
                      title: "Test Task",
                      status: "completed",
                      priority: "medium",
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
          expected: { stdoutExact: CORE_VERSION },
        },
      ],
      cases: [
        {
          id: "version-text",
          exitCode: 0,
          stdoutNormalized: CORE_VERSION,
          stderrNormalized: "",
          comparable: { stdout: CORE_VERSION, stderr: "" },
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
          expected: { stdoutExact: CORE_VERSION },
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

    // The exit-code break is a per-OS baseline failure, so it is reported by
    // validateBaseline on the platform that produced the artifact — not by the
    // cross-OS comparison, which now only reports divergence.
    expect(
      validateBaseline(windowsArtifact, "windows").some((issue) => issue.includes("exit code")),
    ).toBe(true);
    expect(
      validateBaseline(macArtifact, "macos").filter((issue) => issue.includes("version-text")),
    ).toEqual([]);

    const issues = compareArtifacts(macArtifact, windowsArtifact);
    expect(issues.some((issue) => issue.includes("exit code"))).toBe(false);
    expect(issues.some((issue) => issue.includes("parity:version-text.comparable.stdout differs"))).toBe(true);
  });

  it("reports normalized error code mismatches with the scenario name", () => {
    const macArtifact = {
      sequence: [
        {
          id: "unknown-command",
          fixture: "none",
          args: ["foobar"],
          expectedExitCode: 1,
          expected: {
            stderrCode: CLI_ERROR_CODES.UNKNOWN_COMMAND,
            stderrIncludes: ["Unknown command: foobar", "Hint:"],
          },
        },
      ],
      cases: [
        {
          id: "unknown-command",
          exitCode: 1,
          stdoutNormalized: "",
          stderrNormalized: `Error: [${CLI_ERROR_CODES.UNKNOWN_COMMAND}] Unknown command: foobar`,
          comparable: {
            failure: {
              code: CLI_ERROR_CODES.UNKNOWN_COMMAND,
              detail: "Unknown command: foobar",
            },
          },
        },
      ],
    };
    const windowsArtifact = {
      sequence: macArtifact.sequence,
      cases: [
        {
          id: "unknown-command",
          exitCode: 1,
          stdoutNormalized: "",
          stderrNormalized: `Error: [${CLI_ERROR_CODES.NOT_INITIALIZED}] Missing .rex in C:/temp/project`,
          comparable: {
            failure: {
              code: CLI_ERROR_CODES.NOT_INITIALIZED,
              detail: "Missing .rex in C:/temp/project",
            },
          },
        },
      ],
    };

    expect(compareArtifacts(macArtifact, windowsArtifact)).toContain(
      `parity:unknown-command normalized error code mismatch (macos="${CLI_ERROR_CODES.UNKNOWN_COMMAND}" windows="${CLI_ERROR_CODES.NOT_INITIALIZED}")`,
    );
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
          stdoutNormalized: CORE_VERSION,
          stderrNormalized: "",
          comparable: { stdout: CORE_VERSION, stderr: "" },
        },
        {
          id: "version-json",
          exitCode: 0,
          stdoutNormalized: `{"version":"${CORE_VERSION}"}`,
          stderrNormalized: "",
          comparable: { stdoutJson: { version: CORE_VERSION } },
        },
        {
          id: "unknown-command",
          exitCode: 1,
          stdoutNormalized: "",
          stderrNormalized: `Error: [${CLI_ERROR_CODES.UNKNOWN_COMMAND}] Unknown command: foobar\nHint: Run 'ndx --help' to see available commands, or 'ndx help <keyword>' to search.`,
          failure: {
            code: CLI_ERROR_CODES.UNKNOWN_COMMAND,
            detail: "Unknown command: foobar",
          },
          comparable: {
            failure: {
              code: CLI_ERROR_CODES.UNKNOWN_COMMAND,
              detail: "Unknown command: foobar",
            },
          },
        },
        {
          id: "typo-suggestion",
          exitCode: 1,
          stdoutNormalized: "",
          stderrNormalized: `Error: [${CLI_ERROR_CODES.UNKNOWN_COMMAND}] Unknown command: statis\nHint: Did you mean 'ndx status'?`,
          failure: {
            code: CLI_ERROR_CODES.UNKNOWN_COMMAND,
            detail: "Unknown command: statis",
          },
          comparable: {
            failure: {
              code: CLI_ERROR_CODES.UNKNOWN_COMMAND,
              detail: "Unknown command: statis",
            },
          },
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
          stderrNormalized: `Error: [${CLI_ERROR_CODES.NOT_INITIALIZED}] Missing .rex in <TMPDIR>\nHint: Run 'ndx init <TMPDIR>' to set up the project.`,
          failure: {
            code: CLI_ERROR_CODES.NOT_INITIALIZED,
            detail: "Missing .rex in <TMPDIR>",
          },
          comparable: {
            failure: {
              code: CLI_ERROR_CODES.NOT_INITIALIZED,
              detail: "Missing .rex in <TMPDIR>",
            },
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
                      id: "task-2",
                      level: "task",
                      title: "Another Task",
                      status: "pending",
                      priority: "low",
                      children: [],
                    },
                    {
                      id: "task-1",
                      level: "task",
                      title: "Test Task",
                      status: "completed",
                      priority: "medium",
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
    windowsUnknown.failure = extractFailureMetadata(windowsUnknown.stderrNormalized);
    windowsUnknown.comparable = {
      failure: extractFailureMetadata(windowsUnknown.stderrNormalized),
    };

    expect(compareArtifacts(macArtifact, windowsArtifact)).toEqual([]);
  });

  it("ignores OS-specific failure detail drift when normalized error codes still match", async () => {
    const { sequence } = await collectSmokeArtifact({
      executeCli: createDeterministicSmokeRunner(),
    });
    const macArtifact = {
      sequence,
      cases: [
        {
          id: "version-text",
          exitCode: 0,
          stdoutNormalized: CORE_VERSION,
          stderrNormalized: "",
          comparable: { stdout: CORE_VERSION, stderr: "" },
        },
        {
          id: "version-json",
          exitCode: 0,
          stdoutNormalized: `{"version":"${CORE_VERSION}"}`,
          stderrNormalized: "",
          comparable: { stdoutJson: { version: CORE_VERSION } },
        },
        {
          id: "unknown-command",
          exitCode: 1,
          stdoutNormalized: "",
          stderrNormalized: `Error: [${CLI_ERROR_CODES.UNKNOWN_COMMAND}] Unknown command: foobar\nHint: Run 'ndx --help' to see available commands.`,
          failure: {
            code: CLI_ERROR_CODES.UNKNOWN_COMMAND,
            detail: "Unknown command: foobar",
          },
          comparable: {
            failure: {
              code: CLI_ERROR_CODES.UNKNOWN_COMMAND,
              detail: "Unknown command: foobar",
            },
          },
        },
        {
          id: "typo-suggestion",
          exitCode: 1,
          stdoutNormalized: "",
          stderrNormalized: `Error: [${CLI_ERROR_CODES.UNKNOWN_COMMAND}] Unknown command: statis\nDid you mean status`,
          failure: {
            code: CLI_ERROR_CODES.UNKNOWN_COMMAND,
            detail: "Unknown command: statis",
          },
          comparable: {
            failure: {
              code: CLI_ERROR_CODES.UNKNOWN_COMMAND,
              detail: "Unknown command: statis",
            },
          },
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
          stderrNormalized: `Error: [${CLI_ERROR_CODES.NOT_INITIALIZED}] Missing .rex in <TMPDIR>\nHint: Run 'ndx init <TMPDIR>' to set up the project.`,
          failure: {
            code: CLI_ERROR_CODES.NOT_INITIALIZED,
            detail: "Missing .rex in <TMPDIR>",
          },
          comparable: {
            failure: {
              code: CLI_ERROR_CODES.NOT_INITIALIZED,
              detail: "Missing .rex in <TMPDIR>",
            },
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
                      id: "task-2",
                      level: "task",
                      title: "Another Task",
                      status: "pending",
                      priority: "low",
                      children: [],
                    },
                    {
                      id: "task-1",
                      level: "task",
                      title: "Test Task",
                      status: "completed",
                      priority: "medium",
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
    const statusMissingRexCase = windowsArtifact.cases.find((entry) => entry.id === "status-missing-rex");
    statusMissingRexCase.stderrNormalized = [
      "Error occurred while executing command.",
      `Error: [${CLI_ERROR_CODES.NOT_INITIALIZED}] Missing .rex in C:/Users/runneradmin/AppData/Local/Temp/ndx-cli-smoke-123/project`,
      "Hint: Run 'ndx init C:/Users/runneradmin/AppData/Local/Temp/ndx-cli-smoke-123/project' to set up the project.",
      "native process exited with code 1",
    ].join("\n");
    statusMissingRexCase.failure = extractFailureMetadata(statusMissingRexCase.stderrNormalized);
    statusMissingRexCase.comparable = {
      failure: extractFailureMetadata(statusMissingRexCase.stderrNormalized),
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
    const versionTextCase = artifact.cases.find((entry) => entry.id === "version-text");

    expect(versionJsonCase.comparable).toEqual({ stdoutJson: { version: CORE_VERSION } });
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
                id: "task-2",
                level: "task",
                title: "Another Task",
                status: "pending",
                priority: "low",
                children: [],
              },
              {
                id: "task-1",
                level: "task",
                title: "Test Task",
                status: "completed",
                priority: "medium",
                children: [],
              },
            ],
          },
        ],
      },
    });
    expect(versionTextCase).not.toHaveProperty("failure");
    expect(versionJsonCase).not.toHaveProperty("failure");
    expect(typoCase.failure).toEqual({
      code: CLI_ERROR_CODES.UNKNOWN_COMMAND,
      detail: "Unknown command: statis",
    });
    expect(typoCase).not.toHaveProperty("stdout");
    expect(typoCase).not.toHaveProperty("stderr");
    expect(typoCase.comparable).toEqual({
      failure: {
        code: CLI_ERROR_CODES.UNKNOWN_COMMAND,
        detail: "Unknown command: statis",
      },
    });
    expect(artifact.sequence).toEqual([
      {
        id: "version-text",
        fixture: "none",
        args: ["version"],
        expectedExitCode: 0,
        expected: { stdoutExact: CORE_VERSION, stderrExact: "" },
        shapeParity: true,
      },
      {
        id: "version-json",
        fixture: "none",
        args: ["version", "--json"],
        expectedExitCode: 0,
        expected: { stdoutJson: { version: CORE_VERSION } },
        shapeParity: true,
      },
      {
        id: "unknown-command",
        fixture: "none",
        args: ["foobar"],
        expectedExitCode: 1,
        expected: { stderrCode: CLI_ERROR_CODES.UNKNOWN_COMMAND, stderrIncludes: ["Unknown command: foobar", "Hint:"] },
        shapeParity: true,
      },
      {
        id: "typo-suggestion",
        fixture: "none",
        args: ["statis"],
        expectedExitCode: 1,
        expected: { stderrCode: CLI_ERROR_CODES.UNKNOWN_COMMAND, stderrIncludes: ["Unknown command: statis", "Did you mean", "status"] },
        shapeParity: true,
      },
      {
        id: "help-rex",
        fixture: "none",
        args: ["help", "rex"],
        expectedExitCode: 0,
        expected: { stdoutIncludes: ["Rex — available commands", "validate", "rex <command> --help"] },
        shapeParity: true,
      },
      {
        id: "plan-help",
        fixture: "none",
        args: ["help", "plan"],
        expectedExitCode: 0,
        expected: { stdoutIncludes: ["ndx plan", "USAGE", "EXAMPLES", "See also:"] },
        shapeParity: true,
      },
      {
        id: "status-missing-rex",
        fixture: "empty",
        args: ["status", "<TMPDIR>"],
        expectedExitCode: 1,
        expected: { stderrCode: CLI_ERROR_CODES.NOT_INITIALIZED, stderrIncludes: ["Missing", ".rex", "Hint:", "ndx init"] },
        shapeParity: false,
      },
      {
        id: "status-json",
        fixture: "rex",
        args: ["status", "--format=json", "<TMPDIR>"],
        expectedExitCode: 0,
        shapeParity: false,
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
                    id: "task-2",
                    level: "task",
                    title: "Another Task",
                    status: "pending",
                    priority: "low",
                    children: [],
                  },
                  {
                    id: "task-1",
                    level: "task",
                    title: "Test Task",
                    status: "completed",
                    priority: "medium",
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

    expect(validateBaseline(windowsArtifact, "windows")).toContain(
      'windows:status-json.stdoutJson.title differs (expected="Test Project" actual="Windows Project")',
    );
    expect(compareArtifacts(macArtifact, windowsArtifact)).toContain(
      'parity:status-json.comparable.stdoutJson.title differs (macos="Test Project" windows="Windows Project")',
    );
  });

  it("passes the baseline for an artifact collected from a conforming CLI", async () => {
    const artifact = await collectSmokeArtifact({
      executeCli: createDeterministicSmokeRunner(),
    });

    expect(validateBaseline(artifact, "macos")).toEqual([]);
  });

  it("fails the baseline on the collecting platform when a case regresses", async () => {
    const artifact = await collectSmokeArtifact({
      executeCli: createDeterministicSmokeRunner({ statusTitle: "Windows Project" }),
    });

    expect(validateBaseline(artifact, "windows")).toContain(
      'windows:status-json.stdoutJson.title differs (expected="Test Project" actual="Windows Project")',
    );
  });

  it("reports a missing case as a baseline failure rather than skipping it", () => {
    const issues = validateBaseline({ cases: [] }, "windows");

    expect(issues).toContain("windows:missing collected case version-text");
    expect(issues).toHaveLength(SMOKE_CASES.length);
  });

  it("enforces stderrExact so a clean stream is asserted per platform, not just matched", () => {
    const versionText = SMOKE_CASES.find((smokeCase) => smokeCase.id === "version-text");
    expect(versionText.expected.stderrExact).toBe("");

    const noisy = {
      cases: [
        {
          id: "version-text",
          exitCode: 0,
          stdoutNormalized: CORE_VERSION,
          stderrNormalized: "warning: something leaked to stderr",
          comparable: { stdout: CORE_VERSION, stderr: "warning: something leaked to stderr" },
        },
      ],
    };

    expect(
      validateBaseline(noisy, "windows").some((issue) =>
        issue.includes("version-text stderr did not match expected static text")),
    ).toBe(true);
  });

  it("fingerprints raw separators and line endings before normalization erases them", () => {
    expect(describeShape("plain output\n")).toEqual({ crlfCount: 0, backslashCount: 0 });
    expect(describeShape("a\r\nb\r\n")).toEqual({ crlfCount: 2, backslashCount: 0 });
    expect(describeShape("C:\\Users\\me\n")).toEqual({ crlfCount: 0, backslashCount: 2 });

    // normalizeText flattens both, which is exactly the blind spot describeShape covers.
    expect(normalizeText("a\r\nb")).toBe(normalizeText("a\nb"));
    expect(describeShape("a\r\nb")).not.toEqual(describeShape("a\nb"));
  });

  it("excludes runtime noise from the shape fingerprint", () => {
    const noise = "(node:12345) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.\n";

    expect(describeShape(`${noise}1.2.3\n`)).toEqual(describeShape("1.2.3\n"));
  });

  it("records a shape fingerprint only for path-free cases", async () => {
    const artifact = await collectSmokeArtifact({
      executeCli: createDeterministicSmokeRunner(),
    });

    for (const smokeCase of SMOKE_CASES) {
      const collected = artifact.cases.find((entry) => entry.id === smokeCase.id);
      if (smokeCase.shapeParity) {
        expect(collected.shape, `${smokeCase.id} should carry a shape fingerprint`).toEqual({
          stdout: expect.objectContaining({ crlfCount: expect.any(Number) }),
          stderr: expect.objectContaining({ backslashCount: expect.any(Number) }),
        });
      } else {
        expect(collected, `${smokeCase.id} embeds a temp path and must not be shape-compared`)
          .not.toHaveProperty("shape");
      }
    }

    // The fixture cases are the excluded ones, and they are excluded because
    // their output carries native temp paths.
    expect(SMOKE_CASES.filter((smokeCase) => !smokeCase.shapeParity).map((smokeCase) => smokeCase.id))
      .toEqual(["status-missing-rex", "status-json"]);
  });

  it("fails parity on separator drift that normalization would have hidden", async () => {
    const macArtifact = await collectSmokeArtifact({
      executeCli: createDeterministicSmokeRunner(),
    });
    const windowsArtifact = structuredClone(macArtifact);

    expect(compareArtifacts(macArtifact, windowsArtifact)).toEqual([]);

    // A hardcoded CRLF on one platform only. Every normalized field still
    // matches, so this is invisible without the shape fingerprint.
    const helpCase = windowsArtifact.cases.find((entry) => entry.id === "help-rex");
    helpCase.shape.stdout.crlfCount += 3;

    expect(compareArtifacts(macArtifact, windowsArtifact)).toContain(
      "parity:help-rex.shape.stdout.crlfCount differs (macos=0 windows=3)",
    );
  });

  it("fails parity on backslash drift in path-free output", async () => {
    const macArtifact = await collectSmokeArtifact({
      executeCli: createDeterministicSmokeRunner(),
    });
    const windowsArtifact = structuredClone(macArtifact);
    const planCase = windowsArtifact.cases.find((entry) => entry.id === "plan-help");
    planCase.shape.stdout.backslashCount = 4;

    expect(compareArtifacts(macArtifact, windowsArtifact)).toContain(
      "parity:plan-help.shape.stdout.backslashCount differs (macos=0 windows=4)",
    );
  });

  it("compares shape on failure cases, which short-circuit the comparable diff", async () => {
    const macArtifact = await collectSmokeArtifact({
      executeCli: createDeterministicSmokeRunner(),
    });
    const windowsArtifact = structuredClone(macArtifact);
    const typoCase = windowsArtifact.cases.find((entry) => entry.id === "typo-suggestion");
    typoCase.shape.stderr.crlfCount = 2;

    expect(compareArtifacts(macArtifact, windowsArtifact)).toContain(
      "parity:typo-suggestion.shape.stderr.crlfCount differs (macos=0 windows=2)",
    );
  });
});
