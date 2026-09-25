<img src="/hench.png" alt="Hench" width="96" style="float: right; margin: 0 0 1rem 1rem;" />

# Hench

Autonomous agent that picks Rex tasks, builds briefs with codebase context, runs an LLM tool-use loop to implement them, and records everything.

## How It Works

1. **Pick task** — selects the highest-priority pending task (or a specific one via `--task`)
2. **Build brief** — gathers relevant files, acceptance criteria, related code, and SourceVision context
3. **Execute** — runs an LLM tool-use loop with file operations, shell commands, and git
4. **Record** — saves the full run transcript, token usage, and outcome to `.hench/runs/`

## CLI

```sh
hench run .                          # interactive task selection
hench run --auto .                   # highest-priority task
hench run --task=abc123 .            # specific task
hench run --auto --iterations=4 .    # run 4 tasks sequentially
hench run --dry-run .                # preview brief without executing
hench run --model=claude-opus-5 .          # override model
hench config .                       # view workflow configuration
hench config hench.maxTurns 30 .     # edit a config value
hench template list .                # list workflow templates
hench template apply <name> .        # apply a saved template
hench status .                       # show recent runs
hench show <run-id> .                # detailed run transcript
```

Or through the orchestrator:

```sh
ndx work --auto .
ndx work --epic="Auth System" --auto --iterations=2 .
```

## Agent Tools

The agent has access to 9 tools during execution:

| Tool | Description |
|------|-------------|
| File read | Read files from the project |
| File write | Create or overwrite files |
| File edit | Make targeted edits to existing files |
| Shell | Execute shell commands (30s timeout) |
| Git | Git operations (status, diff, commit) |
| Search | Grep and glob for code search |
| Rex update | Update task status in the PRD |
| Log | Write to the execution log |
| Subtask | Create subtasks under the current task |

## Security Guardrails

- **Blocked paths** — cannot modify files outside the project directory
- **Allowed commands** — shell commands are restricted to a safe set
- **Timeouts** — 30-second timeout per shell command
- **File size limit** — 1 MB maximum per file write
- **No `.rex/` writes** — agent cannot directly modify PRD files; all mutations go through Rex's store layer

## Configuration

Stored in `.hench/config.json`:

```sh
ndx config hench.provider api .       # api or cli
ndx config hench.maxTurns 30 .        # max tool-use turns per task
ndx config hench.maxTokens 100000 .   # token budget per task
```

## Run Loop Invariants

The multi-iteration run loop (`--auto`, `--loop`, `--iterations=N`) enforces three invariants that prevent wasted work. Any contributor modifying the loop logic should verify all three are preserved. See [`docs/contributing/run-loop-invariants.md`](../contributing/run-loop-invariants.md) for the full reference including concrete correct vs. incorrect examples and the exact code paths.

**I1 — No completed-task re-pick.** `collectCompletedIds()` is called before every `runOne()` call; completed IDs are merged into `combinedExcludedIds` and forwarded to `findNextTask()`. A task that reached `completed` status is never selected again.

**I2 — Force advancement at three attempts.** `createAttemptTracker()` counts per-task runs within one invocation. At `MAX_TASK_ATTEMPTS = 3` the task is added to `forcedExclusionIds` and skipped for the rest of the run. Code: `run.ts:38–70` (tracker) and `run.ts:1206–1213` / `run.ts:1352–1358` (enforcement).

**I3 — Status transition before next selection.** `finalizeRun()` calls `updateCompletedTaskStatus()` (success) or `handleRunFailure()` (failure) before returning to the outer loop. The PRD write is synchronous with `runOne()`, so the next `collectCompletedIds()` call always sees the updated status.

## Completion Waits for the Test Gate

A task is never marked `completed` before hench's full test gate passes. The agent still marks its own task completed — through rex MCP, `rex update` from its shell, or the API loop's `rex_update_status` — but while the run holds the task's claim, rex records that request on the claim (in the git common directory, where no commit can pick it up) instead of writing it. The agent's `git add -A && git commit` therefore cannot carry the status into the work commit.

- **Gate passes:** hench marks the task completed with the agent's resolution type and detail, in its own record commit.
- **Gate fails:** the task is not completed on disk or in any commit. The agent's resolution is kept on the run record (`completionHold`) and in the execution log (`completion_not_applied`) for the retry. Review repairs are committed as their own commit on `autoCommit`, or named as left uncommitted otherwise.

Outside a hench run nothing holds a completion, so interactive MCP use and the rex CLI behave as before. A failed gate's record also carries a failure digest (`testGate.failureDigest`): the FAIL lines, the first assertion blocks and the per-suite summary, taken from the whole output so that a long stream of stderr cannot push them out.

## Stuck Detection

If a task fails repeatedly (default threshold: 3 consecutive failures including completion rejections), stuck detection kicks in and moves to the next task. This prevents infinite loops on unfixable tasks.

## Run Records

Each run is saved to `.hench/runs/<run-id>/`:

- `run.json` — metadata, outcome, token usage
- `transcript.jsonl` — full conversation transcript
- `brief.md` — the brief that was sent to the LLM
