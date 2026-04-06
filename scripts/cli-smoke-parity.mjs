import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { exec } from "../packages/llm-client/dist/public.js";
import { CLI_PATH, setupRexDir } from "../tests/e2e/e2e-helpers.js";

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

export function normalizeText(text, placeholders = []) {
  let normalized = String(text ?? "").replace(/\r\n/g, "\n").replace(/\\/g, "/");
  for (const [source, replacement] of placeholders) {
    if (!source) continue;
    normalized = normalized.split(String(source).replace(/\\/g, "/")).join(replacement);
  }
  return normalized.replace(/[ \t]+\n/g, "\n").trim();
}

async function runCli(args) {
  const result = await exec(process.execPath, [CLI_PATH, ...args], {
    cwd: ROOT,
    timeout: 15000,
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
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
      return { stdoutJson: JSON.parse(result.stdoutNormalized) };
    },
  },
  {
    id: "unknown-command",
    args: () => ["foobar"],
    expectedExitCode: 1,
    expected: {
      stderrIncludes: ["Error: Unknown command: foobar", "Hint:"],
    },
    comparable(result) {
      return { stderr: result.stderrNormalized };
    },
  },
  {
    id: "typo-suggestion",
    args: () => ["statis"],
    expectedExitCode: 1,
    expected: {
      stderrIncludes: ["Error: Unknown command: statis", "Did you mean", "status"],
    },
    comparable(result) {
      return { stderr: result.stderrNormalized };
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
      stderrIncludes: ["Missing", ".rex", "Hint:", "ndx init"],
    },
    comparable(result) {
      return { stderr: result.stderrNormalized };
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
    comparable(result) {
      const parsed = JSON.parse(result.stdoutNormalized);
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

export async function collectSmokeArtifact() {
  const cases = [];
  for (const smokeCase of SMOKE_CASES) {
    const entry = await withFixture(smokeCase.fixture, async (tempDir) => {
      const placeholders = [
        [ROOT, "<ROOT>"],
        [tempDir, "<TMPDIR>"],
      ];
      const args = smokeCase.args({ tempDir });
      const result = await runCli(args);
      const normalized = {
        id: smokeCase.id,
        args,
        exitCode: result.exitCode,
        stdoutNormalized: normalizeText(result.stdout, placeholders),
        stderrNormalized: normalizeText(result.stderr, placeholders),
      };
      return {
        ...normalized,
        comparable: smokeCase.comparable(normalized),
      };
    });
    cases.push(entry);
  }

  return {
    schemaVersion: "ndx/cli-smoke-parity/v1",
    platform: process.platform,
    nodeVersion: process.version,
    cases,
  };
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

  if (caseDefinition.expected.stdoutJson !== undefined) {
    const actual = collectedCase.comparable.stdoutJson;
    if (JSON.stringify(actual) !== JSON.stringify(caseDefinition.expected.stdoutJson)) {
      issues.push(`${artifactLabel}:${caseDefinition.id} JSON projection did not match expected stable contract`);
    }
  }

  return issues;
}

export function compareArtifacts(macArtifact, windowsArtifact) {
  const issues = [];
  for (const smokeCase of SMOKE_CASES) {
    const macCase = macArtifact.cases.find((entry) => entry.id === smokeCase.id);
    const windowsCase = windowsArtifact.cases.find((entry) => entry.id === smokeCase.id);

    if (!macCase || !windowsCase) {
      issues.push(`missing collected case ${smokeCase.id}`);
      continue;
    }

    issues.push(...compareExpected(smokeCase, macCase, "macos"));
    issues.push(...compareExpected(smokeCase, windowsCase, "windows"));

    if (JSON.stringify(macCase.comparable) !== JSON.stringify(windowsCase.comparable)) {
      issues.push(`parity mismatch for ${smokeCase.id}`);
    }
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
    const artifact = await collectSmokeArtifact();
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
