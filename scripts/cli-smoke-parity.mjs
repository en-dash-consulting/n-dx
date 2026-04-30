import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { CLI_PATH, setupRexDir } from "../tests/e2e/e2e-helpers.js";

const CLI_ERROR_CODES = Object.freeze({
  GENERIC: "NDX_CLI_GENERIC",
  NOT_INITIALIZED: "NDX_CLI_NOT_INITIALIZED",
  UNKNOWN_COMMAND: "NDX_CLI_UNKNOWN_COMMAND",
});

const ROOT = join(import.meta.dirname, "..");
const CORE_PACKAGE_JSON = JSON.parse(
  readFileSync(join(ROOT, "packages/core/package.json"), "utf-8"),
);

function stableItems(items = []) {
  return items.map((item) => ({
    id: item.id,
    level: item.level,
    title: item.title,
    status: item.status,
    priority: item.priority,
    children: stableItems(item.children),
  }));
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stripKnownRuntimeNoise(text) {
  return text
    .replace(
      /^\(node:\d+\) \[DEP0040\] DeprecationWarning: The `punycode` module is deprecated\. Please use a userland alternative instead\.\n?/gm,
      "",
    )
    .replace(/^\(Use `node --trace-deprecation \.\.\.` to show where the warning was created\)\n?/gm, "")
    .replace(
      /^\[child-lifecycle\] process group cleanup is not supported on this platform; falling back to direct child kill\n?/gm,
      "",
    );
}

class SmokeCollectionError extends Error {
  constructor(stage, smokeCaseId, detail) {
    super(`CLI smoke collect failed at ${stage} for ${smokeCaseId}: ${detail}`);
    this.name = "SmokeCollectionError";
    this.stage = stage;
    this.smokeCaseId = smokeCaseId;
  }
}

export function normalizeText(text, placeholders = []) {
  let normalized = stripKnownRuntimeNoise(String(text ?? ""))
    .replace(/\r\n/g, "\n")
    .replace(/\\/g, "/");
  for (const [source, replacement] of placeholders) {
    if (!source) continue;
    normalized = normalized.split(String(source).replace(/\\/g, "/")).join(replacement);
  }
  return normalized.replace(/[ \t]+\n/g, "\n").trim();
}

function findJsonPayloadBounds(text) {
  const start = text.search(/[{\[]/);
  if (start === -1) {
    return null;
  }

  const stack = [text[start]];
  let inString = false;
  let escaped = false;

  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }

    if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      if (stack.at(-1) !== expected) {
        return { start, end: index + 1, complete: false };
      }
      stack.pop();
      if (stack.length === 0) {
        return { start, end: index + 1, complete: true };
      }
    }
  }

  return { start, end: text.length, complete: false };
}

export function extractJsonPayload(text) {
  const normalized = normalizeText(text);
  const bounds = findJsonPayloadBounds(normalized);
  if (!bounds) {
    return { payload: "", normalized, hadNoise: normalized.length > 0 };
  }

  return {
    payload: normalized.slice(bounds.start, bounds.end).trim(),
    normalized,
    hadNoise:
      bounds.start > 0
      || bounds.end < normalized.length
      || normalized.slice(0, bounds.start).trim().length > 0
      || normalized.slice(bounds.end).trim().length > 0,
    complete: bounds.complete,
  };
}

export function parseJsonPayload(text, smokeCaseId, streamLabel = "stdout") {
  const { payload, normalized, complete } = extractJsonPayload(text);
  if (!payload) {
    throw new SmokeCollectionError(
      "json-extract",
      smokeCaseId,
      `no JSON payload found in ${streamLabel}`,
    );
  }
  if (!complete) {
    throw new SmokeCollectionError(
      "json-extract",
      smokeCaseId,
      `${streamLabel} ended before a complete JSON payload was emitted`,
    );
  }

  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new SmokeCollectionError(
      "json-parse",
      smokeCaseId,
      `${streamLabel} JSON payload could not be parsed: ${error.message}; normalized=${JSON.stringify(normalized)}`,
    );
  }
}

export function extractErrorCode(text) {
  const normalized = normalizeText(text);
  const match = normalized.match(/^Error:\s+\[(NDX_CLI_[A-Z_]+)\]/m);
  return match?.[1] ?? CLI_ERROR_CODES.GENERIC;
}

export function extractFailureMetadata(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  const firstLine = normalized.split("\n", 1)[0] ?? "";
  const detail = firstLine.replace(/^Error:\s+(?:\[(NDX_CLI_[A-Z_]+)\]\s+)?/, "").trim();

  return {
    code: extractErrorCode(normalized),
    detail,
  };
}

function createCliRunner(command = process.execPath, commandArgs = command === process.execPath ? [CLI_PATH] : []) {
  return async function runCli(args) {
    const result = await execCommand(command, [...commandArgs, ...args], {
      cwd: ROOT,
      timeout: 15000,
      env: process.env,
      shell: shouldUseShellForCliCommand(command),
    });
    return {
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  };
}

const runCli = createCliRunner();

export function shouldUseShellForCliCommand(command, platform = process.platform) {
  return platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

function execCommand(command, args, options) {
  const { cwd, timeout, env, shell = false } = options;

  return new Promise((resolve) => {
    execFile(command, args, {
      cwd,
      timeout,
      env,
      shell,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      const isTimeout = error
        ? (error.code === "ETIMEDOUT") || error.killed === true
        : false;

      resolve({
        stdout: (stdout ?? "").toString(),
        stderr: (stderr ?? "").toString(),
        exitCode:
          error
            ? (isTimeout
              ? null
              : typeof error.code === "number"
                ? error.code
                : 1)
            : 0,
        error: error ?? null,
      });
    });
  });
}

async function collectCase(smokeCase, executeCli) {
  return withFixture(smokeCase.fixture, async (tempDir) => {
    const placeholders = [
      [ROOT, "<ROOT>"],
      [tempDir, "<TMPDIR>"],
    ];
    const args = smokeCase.args({ tempDir });
    const result = await executeCli(args);
    const normalized = {
      id: smokeCase.id,
      args,
      exitCode: result.exitCode,
      stdoutNormalized: normalizeText(result.stdout, placeholders),
      stderrNormalized: normalizeText(result.stderr, placeholders),
    };
    const failure = normalized.exitCode === 0
      ? undefined
      : extractFailureMetadata(normalized.stderrNormalized);
    let comparable;
    try {
      comparable = smokeCase.comparable(normalized);
    } catch (error) {
      if (error instanceof SmokeCollectionError) {
        throw error;
      }
      throw new SmokeCollectionError(
        "compare",
        smokeCase.id,
        error instanceof Error ? error.message : String(error),
      );
    }
    return {
      ...normalized,
      ...(failure ? { failure } : {}),
      comparable,
    };
  });
}

async function withFixture(fixture, fn) {
  const tempDir = await mkdtemp(join(tmpdir(), "ndx-cli-smoke-"));
  try {
    if (fixture === "rex") {
      await setupRexDir(tempDir);
    }
    return await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function describeSmokeCase(smokeCase) {
  return {
    id: smokeCase.id,
    fixture: smokeCase.fixture ?? "none",
    args: smokeCase.args({ tempDir: "<TMPDIR>" }),
    expectedExitCode: smokeCase.expectedExitCode,
    expected: stableValue(smokeCase.expected),
  };
}

export const SMOKE_CASES = [
  {
    id: "version-text",
    args: () => ["version"],
    expectedExitCode: 0,
    expected: { stdoutExact: CORE_PACKAGE_JSON.version },
    comparable(result) {
      return { stdout: result.stdoutNormalized, stderr: result.stderrNormalized };
    },
  },
  {
    id: "version-json",
    args: () => ["version", "--json"],
    expectedExitCode: 0,
    expected: { stdoutJson: { version: CORE_PACKAGE_JSON.version } },
    comparable(result) {
      return { stdoutJson: parseJsonPayload(result.stdoutNormalized, "version-json") };
    },
  },
  {
    id: "unknown-command",
    args: () => ["foobar"],
    expectedExitCode: 1,
    expected: {
      stderrCode: CLI_ERROR_CODES.UNKNOWN_COMMAND,
      stderrIncludes: ["Unknown command: foobar", "Hint:"],
    },
    comparable(result) {
      return { failure: extractFailureMetadata(result.stderrNormalized) };
    },
  },
  {
    id: "typo-suggestion",
    args: () => ["statis"],
    expectedExitCode: 1,
    expected: {
      stderrCode: CLI_ERROR_CODES.UNKNOWN_COMMAND,
      stderrIncludes: ["Unknown command: statis", "Did you mean", "status"],
    },
    comparable(result) {
      return { failure: extractFailureMetadata(result.stderrNormalized) };
    },
  },
  {
    id: "help-rex",
    args: () => ["help", "rex"],
    expectedExitCode: 0,
    expected: {
      stdoutIncludes: [
        "Rex — available commands",
        "validate",
        "rex <command> --help",
      ],
    },
    comparable(result) {
      return { stdout: result.stdoutNormalized };
    },
  },
  {
    id: "plan-help",
    args: () => ["help", "plan"],
    expectedExitCode: 0,
    expected: {
      stdoutIncludes: ["ndx plan", "USAGE", "EXAMPLES", "See also:"],
    },
    comparable(result) {
      return { stdout: result.stdoutNormalized };
    },
  },
  {
    id: "status-missing-rex",
    fixture: "empty",
    args: ({ tempDir }) => ["status", tempDir],
    expectedExitCode: 1,
    expected: {
      stderrCode: CLI_ERROR_CODES.NOT_INITIALIZED,
      stderrIncludes: ["Missing", ".rex", "Hint:", "ndx init"],
    },
    comparable(result) {
      return { failure: extractFailureMetadata(result.stderrNormalized) };
    },
  },
  {
    id: "status-json",
    fixture: "rex",
    args: ({ tempDir }) => ["status", "--format=json", tempDir],
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
    comparable(result) {
      const parsed = parseJsonPayload(result.stdoutNormalized, "status-json");
      return {
        stdoutJson: {
          schema: parsed.schema,
          title: parsed.title,
          items: stableItems(parsed.items),
        },
      };
    },
  },
];

export async function collectSmokeArtifact({ executeCli = runCli } = {}) {
  const cases = [];
  for (const smokeCase of SMOKE_CASES) {
    const entry = await collectCase(smokeCase, executeCli);
    cases.push(entry);
  }

  return {
    schemaVersion: "ndx/cli-smoke-parity/v1",
    sequence: SMOKE_CASES.map((smokeCase) => describeSmokeCase(smokeCase)),
    platform: process.platform,
    nodeVersion: process.version,
    cases,
  };
}

function diffValues(path, expected, actual, issues, labels) {
  const currentPath = path || "value";
  if (JSON.stringify(expected) === JSON.stringify(actual)) {
    return;
  }

  if (
    expected
    && actual
    && typeof expected === "object"
    && typeof actual === "object"
    && !Array.isArray(expected)
    && !Array.isArray(actual)
  ) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      diffValues(`${currentPath}.${key}`, expected[key], actual[key], issues, labels);
    }
    return;
  }

  issues.push(
    `${currentPath} differs (${labels.left}=${JSON.stringify(expected)} ${labels.right}=${JSON.stringify(actual)})`,
  );
}

function compareSequence(artifact, artifactLabel) {
  const expectedSequence = SMOKE_CASES.map((smokeCase) => describeSmokeCase(smokeCase));
  const issues = [];

  if (!Array.isArray(artifact.sequence)) {
    return [`${artifactLabel}:artifact missing canonical smoke sequence metadata`];
  }

  diffValues(
    `${artifactLabel}:sequence`,
    stableValue(expectedSequence),
    stableValue(artifact.sequence),
    issues,
    { left: "expected", right: "actual" },
  );
  return issues;
}

function compareExpected(caseDefinition, collectedCase, artifactLabel) {
  const issues = [];
  if (collectedCase.exitCode !== caseDefinition.expectedExitCode) {
    issues.push(
      `${artifactLabel}:${caseDefinition.id} exit code ${collectedCase.exitCode} != ${caseDefinition.expectedExitCode}`,
    );
  }

  if (caseDefinition.expected.stdoutExact !== undefined
      && collectedCase.stdoutNormalized !== caseDefinition.expected.stdoutExact) {
    issues.push(`${artifactLabel}:${caseDefinition.id} stdout did not match expected static text`);
  }

  for (const expectedText of caseDefinition.expected.stdoutIncludes ?? []) {
    if (!collectedCase.stdoutNormalized.includes(expectedText)) {
      issues.push(`${artifactLabel}:${caseDefinition.id} stdout missing "${expectedText}"`);
    }
  }

  for (const expectedText of caseDefinition.expected.stderrIncludes ?? []) {
    if (!collectedCase.stderrNormalized.includes(expectedText)) {
      issues.push(`${artifactLabel}:${caseDefinition.id} stderr missing "${expectedText}"`);
    }
  }

  if (caseDefinition.expected.stderrCode !== undefined
      && collectedCase.comparable.failure?.code !== caseDefinition.expected.stderrCode) {
    issues.push(
      `${artifactLabel}:${caseDefinition.id} stderr code ${collectedCase.comparable.failure?.code} != ${caseDefinition.expected.stderrCode}`,
    );
  }

  if (caseDefinition.expected.stdoutJson !== undefined) {
    const actual = collectedCase.comparable.stdoutJson;
    diffValues(
      `${artifactLabel}:${caseDefinition.id}.stdoutJson`,
      stableValue(caseDefinition.expected.stdoutJson),
      stableValue(actual),
      issues,
      { left: "expected", right: "actual" },
    );
  }

  return issues;
}

function projectComparableForParity(comparable) {
  if (!comparable || typeof comparable !== "object") {
    return comparable;
  }

  if (comparable.failure && typeof comparable.failure === "object") {
    return {
      ...comparable,
      failure: {
        code: comparable.failure.code ?? CLI_ERROR_CODES.GENERIC,
      },
    };
  }

  return comparable;
}

export function compareArtifacts(macArtifact, windowsArtifact) {
  const issues = [];
  issues.push(...compareSequence(macArtifact, "macos"));
  issues.push(...compareSequence(windowsArtifact, "windows"));

  for (const smokeCase of SMOKE_CASES) {
    const macCase = macArtifact.cases.find((entry) => entry.id === smokeCase.id);
    const windowsCase = windowsArtifact.cases.find((entry) => entry.id === smokeCase.id);

    if (!macCase || !windowsCase) {
      issues.push(`missing collected case ${smokeCase.id}`);
      continue;
    }

    issues.push(...compareExpected(smokeCase, macCase, "macos"));
    issues.push(...compareExpected(smokeCase, windowsCase, "windows"));

    const macComparable = stableValue(projectComparableForParity(macCase.comparable));
    const windowsComparable = stableValue(projectComparableForParity(windowsCase.comparable));

    const macFailureCode = macComparable?.failure?.code;
    const windowsFailureCode = windowsComparable?.failure?.code;
    if (macFailureCode !== undefined || windowsFailureCode !== undefined) {
      if (macFailureCode !== windowsFailureCode) {
        issues.push(
          `parity:${smokeCase.id} normalized error code mismatch (macos=${JSON.stringify(macFailureCode)} windows=${JSON.stringify(windowsFailureCode)})`,
        );
      }
      continue;
    }

    diffValues(
      `parity:${smokeCase.id}.comparable`,
      macComparable,
      windowsComparable,
      issues,
      { left: "macos", right: "windows" },
    );
  }
  return issues;
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === "collect") {
    const outputIndex = rest.indexOf("--output");
    if (outputIndex === -1 || !rest[outputIndex + 1]) {
      throw new Error("collect requires --output <path>");
    }
    const cliCommandIndex = rest.indexOf("--cli-command");
    const cliCommand = cliCommandIndex === -1 ? process.execPath : rest[cliCommandIndex + 1];
    if (!cliCommand) {
      throw new Error("collect requires a value for --cli-command");
    }
    const artifact = await collectSmokeArtifact({
      executeCli: createCliRunner(
        cliCommand,
        cliCommand === process.execPath ? [CLI_PATH] : [],
      ),
    });
    writeFileSync(rest[outputIndex + 1], JSON.stringify(artifact, null, 2) + "\n", "utf-8");
    return;
  }

  if (command === "compare") {
    const macIndex = rest.indexOf("--mac");
    const windowsIndex = rest.indexOf("--windows");
    if (macIndex === -1 || windowsIndex === -1 || !rest[macIndex + 1] || !rest[windowsIndex + 1]) {
      throw new Error("compare requires --mac <path> --windows <path>");
    }
    const macArtifact = JSON.parse(readFileSync(rest[macIndex + 1], "utf-8"));
    const windowsArtifact = JSON.parse(readFileSync(rest[windowsIndex + 1], "utf-8"));
    const issues = compareArtifacts(macArtifact, windowsArtifact);
    if (issues.length > 0) {
      throw new Error(`CLI smoke parity failed:\n- ${issues.join("\n- ")}`);
    }
    return;
  }

  throw new Error("usage: node scripts/cli-smoke-parity.mjs <collect|compare> ...");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
