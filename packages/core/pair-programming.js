/**
 * Pair-programming cross-vendor review helpers.
 *
 * After the primary vendor completes its work step, the opposite vendor
 * acts as a reviewer: it runs the project's configured test command and
 * reports a pass/fail verdict. This creates a "bickering pair" dynamic
 * where one vendor does the work and the other checks it.
 *
 * Design notes:
 * - The reviewer's availability is checked via a --version probe. If the
 *   binary is not installed or not on PATH, the review step is skipped with
 *   a warning rather than crashing the overall command.
 * - The test command is run as a shell command (not via the LLM itself),
 *   and the output is attributed to the reviewer vendor in the UI.
 * - All exported functions are pure or side-effect-isolated so this module
 *   can be tested independently from cli.js.
 *
 * @module n-dx/pair-programming
 */

import { spawn, execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// NDX context assembly
// ---------------------------------------------------------------------------

/**
 * Read CONTEXT.md from .sourcevision/.
 * Returns the file content string, or null if the file does not exist.
 *
 * @param {string} dir  Project root directory.
 * @returns {{ content: string | null; warning?: string }}
 */
export function readContextMd(dir) {
  const contextPath = join(dir, ".sourcevision", "CONTEXT.md");
  if (!existsSync(contextPath)) {
    return { content: null, warning: "CONTEXT.md not found in .sourcevision/ — skipping codebase context" };
  }
  try {
    return { content: readFileSync(contextPath, "utf-8") };
  } catch (err) {
    return { content: null, warning: `Could not read .sourcevision/CONTEXT.md: ${err.message}` };
  }
}

/**
 * Build a compact PRD status excerpt from `.rex/prd.md` (current source of
 * truth) or `.rex/prd.json` (legacy fallback). Markdown is parsed by spawning
 * `rex parse-md --stdin`. Includes only epic/feature/task titles and their
 * statuses — no descriptions or acceptance criteria, to keep the payload small.
 *
 * @param {string} dir  Project root directory.
 * @returns {{ content: string | null; warning?: string }}
 */
export function buildPrdStatusExcerpt(dir) {
  const mdPath = join(dir, ".rex", "prd.md");
  const jsonPath = join(dir, ".rex", "prd.json");

  /** @type {{ title?: string; items?: unknown } | null} */
  let doc = null;

  if (existsSync(mdPath)) {
    try {
      const md = readFileSync(mdPath, "utf-8");
      const out = execFileSync("rex", ["parse-md", "--stdin"], {
        input: md,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      doc = JSON.parse(out);
    } catch (err) {
      return { content: null, warning: `Could not parse .rex/prd.md: ${err.message}` };
    }
  } else if (existsSync(jsonPath)) {
    try {
      doc = JSON.parse(readFileSync(jsonPath, "utf-8"));
    } catch (err) {
      return { content: null, warning: `Could not read .rex/prd.json: ${err.message}` };
    }
  } else {
    return { content: null, warning: "PRD not found at .rex/prd.md — skipping PRD context" };
  }

  try {
    const lines = [`# PRD: ${doc.title ?? "untitled"}`];
    const formatItems = (items, depth = 0) => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        const indent = "  ".repeat(depth);
        const marker = item.status === "completed" ? "[x]" : "[ ]";
        lines.push(`${indent}${marker} ${item.title} (${item.level}, ${item.status})`);
        if (item.children?.length) {
          formatItems(item.children, depth + 1);
        }
      }
    };
    formatItems(doc.items ?? []);
    return { content: lines.join("\n") };
  } catch (err) {
    return { content: null, warning: `Could not format PRD excerpt: ${err.message}` };
  }
}

/**
 * Assemble the full NDX context payload from available sources.
 *
 * Reads CONTEXT.md and the PRD status excerpt. Missing files produce warnings
 * but do not prevent execution. An empty result (no sources available) returns
 * null text so callers can skip context injection entirely.
 *
 * @param {string} dir  Project root directory.
 * @returns {{ text: string | null; warnings: string[] }}
 */
export function assembleNdxContext(dir) {
  const warnings = [];
  const parts = [];

  const contextMd = readContextMd(dir);
  if (contextMd.warning) warnings.push(contextMd.warning);
  if (contextMd.content) parts.push(contextMd.content);

  const prdExcerpt = buildPrdStatusExcerpt(dir);
  if (prdExcerpt.warning) warnings.push(prdExcerpt.warning);
  if (prdExcerpt.content) parts.push(prdExcerpt.content);

  return {
    text: parts.length > 0 ? parts.join("\n\n---\n\n") : null,
    warnings,
  };
}

/**
 * Write a context payload to a temporary file and return its path.
 * The caller is responsible for deleting the file when done.
 *
 * @param {string} text  Context text to write.
 * @returns {string}  Path to the temporary file.
 */
export function writeNdxContextFile(text) {
  const tmpDir = mkdtempSync(join(tmpdir(), "ndx-ctx-"));
  const filePath = join(tmpDir, "context.md");
  writeFileSync(filePath, text, "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

/**
 * Read the test command from .rex/config.json → `test` field.
 * Returns undefined when the file is absent, malformed, or the field unset.
 *
 * @param {string} dir  Project root directory.
 * @returns {string | undefined}
 */
export function readRexTestCommand(dir) {
  const configPath = join(dir, ".rex", "config.json");
  if (!existsSync(configPath)) return undefined;
  try {
    const data = JSON.parse(readFileSync(configPath, "utf-8"));
    const cmd = data?.test;
    return typeof cmd === "string" && cmd.trim().length > 0 ? cmd.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Determine which vendor should act as reviewer given the primary vendor.
 *
 * @param {"claude" | "codex"} primaryVendor
 * @returns {"claude" | "codex"}
 */
export function resolveReviewerVendor(primaryVendor) {
  return primaryVendor === "claude" ? "codex" : "claude";
}

/**
 * Resolve the CLI binary path for a given vendor.
 * Reads from .n-dx.json (llm.<vendor>.cli_path) and falls back to
 * the bare vendor name (resolved by PATH lookup).
 *
 * @param {string} dir  Project root directory.
 * @param {"claude" | "codex"} vendor
 * @returns {string}  CLI binary path or name.
 */
export function resolveVendorCliPath(dir, vendor) {
  const configPath = join(dir, ".n-dx.json");
  try {
    if (existsSync(configPath)) {
      const data = JSON.parse(readFileSync(configPath, "utf-8"));
      const configured = data?.llm?.[vendor]?.cli_path;
      if (typeof configured === "string" && configured.trim().length > 0) {
        return configured.trim();
      }
      // Legacy claude.cli_path key
      if (vendor === "claude") {
        const legacy = data?.claude?.cli_path;
        if (typeof legacy === "string" && legacy.trim().length > 0) {
          return legacy.trim();
        }
      }
    }
  } catch {
    /* ignore — fall through to default */
  }
  return vendor; // "claude" or "codex" — resolved via PATH
}

// ---------------------------------------------------------------------------
// Availability check
// ---------------------------------------------------------------------------

/**
 * Check whether a vendor CLI binary is accessible.
 * Uses a --version probe with a short timeout to avoid blocking.
 *
 * @param {string} cliPath  Binary path or name.
 * @returns {{ available: boolean }}
 */
export function checkReviewerAvailability(cliPath) {
  try {
    execFileSync(cliPath, ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: "pipe",
      shell: process.platform === "win32",
    });
    return { available: true };
  } catch {
    return { available: false };
  }
}

// ---------------------------------------------------------------------------
// Changed-file discovery
// ---------------------------------------------------------------------------

/**
 * Return a deduplicated list of file paths that changed relative to HEAD.
 * Combines files from the most recent commit and currently dirty files.
 * Returns an empty array when git is unavailable or the directory is not
 * inside a git repository.
 *
 * @param {string} dir  Project root directory.
 * @returns {string[]}
 */
export function getChangedFiles(dir) {
  /** @param {string[]} args */
  const runGit = (args) => {
    try {
      return execFileSync("git", args, {
        cwd: dir,
        encoding: "utf-8",
        timeout: 10_000,
        stdio: "pipe",
      }).trim();
    } catch {
      return "";
    }
  };

  // Files touched in the most recent commit, including the initial commit.
  // --name-only lists only file names; --format= suppresses the commit header.
  const fromLastCommit = runGit(["show", "--name-only", "--format=", "HEAD"])
    .split("\n")
    .filter(Boolean);

  // Files currently staged or unstaged (columns 0-2 of porcelain output are status codes)
  const fromStatus = runGit(["status", "--porcelain"])
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim());

  return [...new Set([...fromLastCommit, ...fromStatus])];
}

// ---------------------------------------------------------------------------
// Reviewer prompt builder
// ---------------------------------------------------------------------------

/**
 * Build a constrained validation-only prompt for the reviewer LLM.
 *
 * The prompt tells the reviewer to check for syntax/logic errors and run
 * the test command, while explicitly capping any fixes at 20 lines per file
 * and prohibiting refactors or architectural changes.
 *
 * @param {{
 *   changedFiles: string[];
 *   testCommand?: string;
 * }} options
 * @returns {string}
 */
export function buildReviewerPrompt({ changedFiles, testCommand }) {
  const fileList =
    changedFiles.length > 0
      ? changedFiles.map((f) => `  - ${f}`).join("\n")
      : "  (no specific files identified — perform a general validation pass)";

  const testSection = testCommand
    ? `\n3. Run the test command and verify it passes:\n   ${testCommand}\n`
    : "";

  return `You are a code reviewer validating changes made by a peer AI assistant. Your role is QA only.

Your task:
1. Inspect the changed files listed below for syntax errors, logic errors, and broken imports
2. Check that the code changes are consistent and complete${testSection}
Changed files to review:
${fileList}

STRICT CONSTRAINTS — you MUST follow these exactly:
- You MAY make small, targeted fixes only (e.g. fixing a broken import, correcting a one-line syntax error, or fixing a mismatched variable name)
- Any single fix must change fewer than 20 lines in a single file
- You MUST NOT perform refactors, renames, module restructuring, or architectural changes
- You MUST NOT rewrite working code even if you think it could be improved
- If you find an issue that requires more than 20 lines of changes, report it but do NOT attempt to fix it

After reviewing, output a brief summary. State PASS if everything looks correct (and tests pass, if applicable). State FAIL and list specific findings if issues were found.`;
}

// ---------------------------------------------------------------------------
// Reviewer LLM invocation
// ---------------------------------------------------------------------------

/**
 * Invoke the reviewer vendor CLI with the given prompt.
 * Inherits the current process's stdio so the user can observe the review
 * in real time. Returns the process exit code and whether it timed out.
 *
 * @param {{
 *   cliPath: string;
 *   prompt: string;
 *   dir: string;
 *   reviewer?: "claude" | "codex";
 *   timeout?: number;
 * }} options
 * @returns {Promise<{ exitCode: number; timedOut: boolean; spawnError?: string }>}
 */
export function runReviewerLlm({ cliPath, prompt, dir, reviewer, timeout = 300_000 }) {
  return new Promise((resolve) => {
    let child;
    try {
      const args = reviewer === "codex" ? ["review", prompt] : [prompt];
      child = spawn(cliPath, args, {
        cwd: dir,
        stdio: "inherit",
        shell: process.platform === "win32",
      });
    } catch (err) {
      resolve({ exitCode: 1, timedOut: false, spawnError: err.message });
      return;
    }

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ exitCode: 1, timedOut: true });
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, timedOut: false });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, timedOut: false, spawnError: err.message });
    });
  });
}

/**
 * Like runReviewerLlm but pipes stdout/stderr to both the terminal and a
 * capture buffer so the output can be parsed for structured feedback.
 *
 * @param {{
 *   cliPath: string;
 *   prompt: string;
 *   dir: string;
 *   reviewer?: "claude" | "codex";
 *   timeout?: number;
 * }} options
 * @returns {Promise<{ exitCode: number; timedOut: boolean; output: string; spawnError?: string }>}
 */
export function runReviewerLlmCapturing({ cliPath, prompt, dir, reviewer, timeout = 300_000 }) {
  return new Promise((resolve) => {
    let child;
    try {
      const args = reviewer === "codex" ? ["review", prompt] : [prompt];
      child = spawn(cliPath, args, {
        cwd: dir,
        stdio: ["inherit", "pipe", "pipe"],
        shell: process.platform === "win32",
      });
    } catch (err) {
      resolve({ exitCode: 1, timedOut: false, spawnError: err.message, output: "" });
      return;
    }

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ exitCode: 1, timedOut: true, output });
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, timedOut: false, output });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, timedOut: false, spawnError: err.message, output });
    });
  });
}

// ---------------------------------------------------------------------------
// ReviewFeedback parser
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ReviewFeedback
 * @property {boolean} passed                         True when reviewer found no issues.
 * @property {string[]} errors                        Issues or errors identified.
 * @property {string[]} suggestedFixes                Fixes the reviewer recommends.
 * @property {"passed"|"failed"|"skipped"} testVerdict  Outcome of the test run.
 */

/**
 * Parse free-form reviewer LLM output into a structured ReviewFeedback object.
 *
 * Heuristics:
 *  - "PASS" with no "FAIL" → passed: true
 *  - Bullet/numbered list items are extracted as errors (default) or suggested
 *    fixes when preceded by a "Suggested fix" / "Fix:" / "Recommendation:" header.
 *  - Test verdict derived from "tests passed" / "tests failed" keywords.
 *
 * @param {string} output  Raw text output from the reviewer LLM.
 * @returns {ReviewFeedback}
 */
export function parseReviewerOutput(output) {
  const hasFail = /\bFAIL\b/.test(output);
  const hasPass = /\bPASS\b/.test(output);
  const passed = hasPass && !hasFail;

  const errors = [];
  const suggestedFixes = [];
  let inFixSection = false;

  for (const raw of output.split("\n")) {
    const line = raw.trim();

    // Section header: "Suggested fix(es)", "Fix:", "Recommendations:"
    if (/^(?:suggested?\s+fix(?:es)?|fix(?:es)?|recommendation(?:s)?)[:]/i.test(line)) {
      inFixSection = true;
      continue;
    }
    // Section header: "Issues:", "Errors:", "Findings:" — switch to errors mode
    if (/^(?:issue(?:s)?|error(?:s)?|finding(?:s)?|problem(?:s)?)[:]/i.test(line)) {
      inFixSection = false;
      continue;
    }
    // Markdown heading: set mode based on heading text
    if (/^#{1,3}\s/.test(line)) {
      inFixSection = /suggest|fix|recommendation/i.test(line);
      continue;
    }

    // Bullet or numbered list item
    const bulletMatch = line.match(/^(?:[-*•]|\d+[.)]) (.+)/);
    if (bulletMatch) {
      const content = bulletMatch[1].trim();
      if (inFixSection) {
        suggestedFixes.push(content);
      } else {
        errors.push(content);
      }
    }
  }

  // Test verdict
  let testVerdict = /** @type {"passed"|"failed"|"skipped"} */ ("skipped");
  if (/\btests?\s+passed\b|\ball\s+tests?\s+pass/i.test(output)) {
    testVerdict = "passed";
  } else if (/\btests?\s+failed\b|\btest\s+failure/i.test(output)) {
    testVerdict = "failed";
  }

  return { passed, errors, suggestedFixes, testVerdict };
}

// ---------------------------------------------------------------------------
// Remediation context builder
// ---------------------------------------------------------------------------

/**
 * Build a context payload instructing the primary model to fix only the
 * reviewer-identified issues. Prepends any existing background context
 * (e.g. CONTEXT.md + PRD status) so the agent retains project awareness.
 *
 * @param {ReviewFeedback} feedback       Parsed reviewer output.
 * @param {string}         description    Original task description.
 * @param {string}         [priorContext] Existing background context to prepend.
 * @returns {string}
 */
export function buildRemediationContext(feedback, description, priorContext) {
  const lines = [];

  if (priorContext) {
    lines.push(priorContext, "", "---", "");
  }

  lines.push(
    "## Code Review Findings — Remediation Pass",
    "",
    `Original task: ${description}`,
    "",
    "The code reviewer identified the following issues. Fix ONLY these issues.",
    "Do not add new features, refactor unrelated code, or make architectural changes.",
    "",
  );

  if (feedback.errors.length > 0) {
    lines.push("### Issues to fix:");
    for (const e of feedback.errors) lines.push(`- ${e}`);
    lines.push("");
  }

  if (feedback.suggestedFixes.length > 0) {
    lines.push("### Reviewer suggested fixes:");
    for (const f of feedback.suggestedFixes) lines.push(`- ${f}`);
    lines.push("");
  }

  lines.push(
    "Apply the minimum changes needed to address the issues above.",
    "After fixing, the reviewer will run a final validation pass.",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Test command runner
// ---------------------------------------------------------------------------

/**
 * Run a shell test command and capture combined stdout + stderr.
 * Always spawns via the system shell so quoted arguments and compound
 * commands (e.g. "pnpm -r test") are handled correctly.
 *
 * @param {string} testCommand  Full shell command (e.g. "pnpm test").
 * @param {string} dir          Working directory.
 * @param {number} [timeout=120000]  Max run time in ms.
 * @returns {Promise<{ exitCode: number; output: string }>}
 */
export function runShellTestCommand(testCommand, dir, timeout = 120_000) {
  return new Promise((resolve) => {
    const child = spawn(testCommand, [], {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ exitCode: 1, output: output + "\n[pair-programming review: test command timed out]" });
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, output });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, output: `[pair-programming review: could not start test command — ${err.message}]` });
    });
  });
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ReviewResult
 * @property {"llm-review"|"shell-test-only"|"skipped"} mode  Review mode.
 * @property {boolean}         skipped         True when the review step was not executed.
 * @property {string}          [reason]        Human-readable reason for skipping.
 * @property {boolean}         [passed]        True when review passed. Present only when !skipped.
 * @property {string}          [command]       The test command run (shell-test-only mode).
 * @property {string}          [output]        Combined stdout + stderr (shell-test-only).
 * @property {number}          [exitCode]      Exit code of the reviewer process.
 * @property {string[]}        [changedFiles]  Files identified as changed.
 * @property {string[]}        [contextFiles]  Context file paths from the primary run.
 * @property {ReviewFeedback}  [feedback]      Structured parsed feedback (llm-review only).
 * @property {string}          [reviewOutput]  Raw captured reviewer output (llm-review only).
 */

/**
 * Run the cross-vendor review step.
 *
 * 1. Resolve the reviewer's CLI binary.
 * 2. If the binary is unavailable, skip with a warning-level result.
 * 3. Collect changed files from git and build a constrained review prompt.
 * 4. Invoke the reviewer LLM with the prompt (mode = "llm-review").
 * 5. If the LLM fails to spawn, fall back to running the shell test command
 *    directly (mode = "shell-test-only") when a test command is configured.
 *
 * @param {{
 *   dir: string;
 *   reviewer: "claude" | "codex";
 *   testCommand?: string;
 *   timeout?: number;
 *   contextFiles?: string[];
 * }} options
 * @returns {Promise<ReviewResult>}
 */
export async function runCrossVendorReview({ dir, reviewer, testCommand, timeout, contextFiles }) {
  const cliPath = resolveVendorCliPath(dir, reviewer);
  const { available } = checkReviewerAvailability(cliPath);

  const ctx = contextFiles?.length ? { contextFiles } : {};

  if (!available) {
    return {
      mode: "skipped",
      skipped: true,
      reason: `${reviewer} CLI not found (tried: ${cliPath}). Install or configure llm.${reviewer}.cli_path.`,
      ...ctx,
    };
  }

  const changedFiles = getChangedFiles(dir);
  const prompt = buildReviewerPrompt({ changedFiles, testCommand });
  const llmTimeout = timeout ?? 300_000;

  const llmResult = await runReviewerLlmCapturing({ cliPath, prompt, dir, reviewer, timeout: llmTimeout });

  if (llmResult.spawnError) {
    // LLM failed to start — fall back to shell tests when a test command is available
    if (testCommand) {
      const { exitCode, output } = await runShellTestCommand(testCommand, dir, 120_000);
      return {
        mode: "shell-test-only",
        skipped: false,
        passed: exitCode === 0,
        command: testCommand,
        output,
        exitCode,
        ...ctx,
      };
    }
    return {
      mode: "skipped",
      skipped: true,
      reason: `${reviewer} reviewer failed to start: ${llmResult.spawnError}`,
      ...ctx,
    };
  }

  const feedback = parseReviewerOutput(llmResult.output);
  return {
    mode: "llm-review",
    skipped: false,
    passed: llmResult.exitCode === 0,
    exitCode: llmResult.exitCode,
    feedback,
    reviewOutput: llmResult.output,
    ...(changedFiles.length ? { changedFiles } : {}),
    ...ctx,
  };
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

const BORDER = "─".repeat(60);

/**
 * Format a ReviewResult for terminal display.
 *
 * Distinguishes three outcome states:
 *   - llm-review       The reviewer LLM was invoked (primary path).
 *   - shell-test-only  LLM spawn failed; fell back to running shell tests.
 *   - skipped          Reviewer CLI unavailable or nothing to run.
 *
 * @param {"claude" | "codex"} reviewer
 * @param {ReviewResult} result
 * @returns {string}
 */
export function formatReviewBanner(reviewer, result) {
  const lines = ["", BORDER, `Reviewer (${reviewer})`, BORDER];

  if (result.skipped) {
    lines.push(`⚠  Review skipped: ${result.reason}`);
  } else if (result.mode === "llm-review") {
    if (result.passed) {
      lines.push("✓  LLM review passed");
      if (result.changedFiles?.length) {
        lines.push(`   Reviewed ${result.changedFiles.length} file(s): ${result.changedFiles.join(", ")}`);
      }
    } else {
      lines.push("✗  LLM review: issues found or reviewer exited with errors");
      lines.push(`   Exit code: ${result.exitCode}`);
    }
  } else if (result.mode === "shell-test-only") {
    if (result.passed) {
      lines.push("✓  Tests passed (shell-test-only — LLM reviewer unavailable)");
      if (result.command) lines.push(`   Command: ${result.command}`);
    } else {
      lines.push("✗  Tests failed (shell-test-only — LLM reviewer unavailable)");
      if (result.command) lines.push(`   Command: ${result.command}`);
      if (result.output?.trim()) {
        lines.push("");
        lines.push(result.output.trim());
      }
    }
  } else {
    // Legacy path: result has no mode field (backward compatibility)
    if (result.passed) {
      lines.push("✓  All tests passed");
      if (result.command) lines.push(`   Command: ${result.command}`);
    } else {
      lines.push("✗  Tests failed");
      if (result.command) lines.push(`   Command: ${result.command}`);
      if (result.output?.trim()) {
        lines.push("");
        lines.push(result.output.trim());
      }
    }
  }

  lines.push(BORDER);
  return lines.join("\n");
}
