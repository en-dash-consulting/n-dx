import type {
  ToolCallRecord,
  RunSummaryData,
  CommandRecord,
  TestRecord,
} from "../../schema/index.js";

/** Patterns that identify a command as a test invocation. */
const TEST_PATTERNS = [
  /\btest\b/i,
  /\bvitest\b/i,
  /\bjest\b/i,
  /\bmocha\b/i,
  /\bava\b/i,
  /\btap\b/i,
  /\bplaywright\b/i,
  /\bcypress\b/i,
];

function isTestCommand(command: string): boolean {
  return TEST_PATTERNS.some((p) => p.test(command));
}

/** Glob-like args we skip when extracting file paths from git add. */
const GLOB_ARGS = new Set([".", "-A", "--all", "-u", "--update"]);

function inferExitStatus(output: string): "ok" | "error" | "timeout" | "blocked" {
  if (output.startsWith("[GUARD]")) return "blocked";
  if (/timed out/i.test(output)) return "timeout";
  if (output.startsWith("[ERROR]") || /exit code/i.test(output)) return "error";
  return "ok";
}

/**
 * Build a structured run summary from raw tool call records.
 *
 * This is a pure function — no I/O, no side effects. It derives
 * structured metadata from the tool calls already recorded by the
 * agent loop.
 */
export function buildRunSummary(toolCalls: ToolCallRecord[]): RunSummaryData {
  const changedSet = new Set<string>();
  const readSet = new Set<string>();
  const commands: CommandRecord[] = [];
  const tests: TestRecord[] = [];

  for (const call of toolCalls) {
    switch (call.tool) {
      case "write_file": {
        const path = call.input.path as string | undefined;
        if (path) changedSet.add(path);
        break;
      }

      case "read_file": {
        const path = call.input.path as string | undefined;
        if (path) readSet.add(path);
        break;
      }

      case "run_command": {
        const cmd = call.input.command as string | undefined;
        if (!cmd) break;

        const exitStatus = inferExitStatus(call.output);
        commands.push({ command: cmd, exitStatus, durationMs: call.durationMs });

        if (isTestCommand(cmd)) {
          tests.push({
            command: cmd,
            passed: exitStatus === "ok",
            durationMs: call.durationMs,
          });
        }
        break;
      }

      case "git": {
        const sub = call.input.subcommand as string | undefined;
        const args = call.input.args as string | undefined;
        if (!sub) break;

        // Record as a command
        const gitCmd = args ? `git ${sub} ${args}` : `git ${sub}`;
        const exitStatus = inferExitStatus(call.output);
        commands.push({ command: gitCmd, exitStatus, durationMs: call.durationMs });

        // Extract file paths from git add
        if (sub === "add" && args) {
          const parts = args.split(/\s+/).filter((p) => p && !GLOB_ARGS.has(p));
          for (const p of parts) {
            changedSet.add(p);
          }
        }
        break;
      }

      // ── Codex CLI tool names ───────────────────────────────────────────────
      // Codex reports file edits as `str_replace_editor` and new files as
      // `create_file`. Shell commands are reported as `shell` (not `run_command`).
      // These cases mirror the Claude equivalents above.

      case "str_replace_editor": {
        // Codex file-editing tool — the `path` argument identifies the changed file
        const path = call.input.path as string | undefined;
        if (path) changedSet.add(path);
        break;
      }

      case "create_file": {
        // Codex file-creation tool — the `path` argument identifies the new file
        const path = call.input.path as string | undefined;
        if (path) changedSet.add(path);
        break;
      }

      case "shell": {
        // Codex shell tool — equivalent to Claude's `run_command`
        const cmd = call.input.command as string | undefined;
        if (!cmd) break;

        const exitStatus = inferExitStatus(call.output);
        commands.push({ command: cmd, exitStatus, durationMs: call.durationMs });

        if (isTestCommand(cmd)) {
          tests.push({
            command: cmd,
            passed: exitStatus === "ok",
            durationMs: call.durationMs,
          });
        }
        break;
      }

      // list_directory, search_files, rex_*, computer — no file/command tracking needed
      default:
        break;
    }
  }

  const filesChanged = [...changedSet].sort();
  const filesRead = [...readSet].sort();

  return {
    filesChanged,
    filesRead,
    commandsExecuted: commands,
    testsRun: tests,
    counts: {
      filesRead: filesRead.length,
      filesChanged: filesChanged.length,
      commandsExecuted: commands.length,
      testsRun: tests.length,
      toolCallsTotal: toolCalls.length,
    },
  };
}
