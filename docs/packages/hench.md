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
hench run --model=claude-opus-5-5 .        # override model
hench run --task=abc123 --no-review .      # skip a review the task saved
hench run --task=abc123 --review-mode=pair --reviewer=codex .  # pair review by codex
hench run --task=abc123 --resolve .        # print the settings a run would use
hench config .                       # view workflow configuration
hench config hench.maxTurns 30 .     # edit a config value
hench template list .                # list workflow templates
hench template apply <name> .        # apply a saved template
hench status .                       # show recent runs
hench show <run-id> .                # detailed run transcript
hench runs diagnose <run-id> .       # why a run failed, and what to do next
```

Or through the orchestrator:

```sh
ndx work --auto .
ndx work --epic="Auth System" --auto --iterations=2 .
```

## Settings Saved on a Task

A PRD item can carry a `run` block saying how `ndx work` should run it — written
by the rex MCP tools (`add_item` / `edit_item`), `rex update --run`, or the
dashboard's Prepare task modal; the dashboard's Start Working button also
writes the project defaults onto a task with no block before it starts the
run. Hench applies it.

**Precedence, per setting:** CLI flag > the task's `run` block > `hench.*` >
`llm.*` > the built-in default.

Resolution happens **per task, after selection**, so inside `--loop`,
`--iterations` and `--epic-by-epic` each task runs with its own saved settings
— including a saved `provider`, which chooses the CLI or API loop for that task
alone. An explicit CLI flag applies to every task in the loop.

Model intent is portable, because a task saved under one vendor may be run under
another: the block carries a `tier` (`light` / `standard` / `heavy`) plus
optional exact `models` pins per vendor. On vendor V the agent model resolves as
`--model` > `models[V]` > `tier` > `hench.models.V` > `llm.*` > default, and the
reviewer as `--review-model` > `reviewModels[V]` > `reviewTier` >
`llm.V.reviewModel` / `llm.reviewModel` > the vendor default.

Who reviews follows the same chain: `--review-mode` (`--review` is self,
`--no-review` is off) > the task's `reviewMode` > its `review` > `hench.review.mode`,
and the pair reviewer is `--reviewer` > `reviewVendor` > `hench.review.vendor` >
the executor's other CLI vendor. A saved `reviewVendor` that is the executor's
own vendor is skipped with a warning (that would be self review).

**A saved value that cannot be honoured never stops a run.** It is skipped with
a warning naming the task, and resolution continues down the chain — a model the
active vendor cannot run, a `provider` the vendor has no loop for (`api` on
codex), a `review` the resolved provider cannot spawn a reviewer on, a
`permissionMode` outside Claude. A block that fails rex's validator is ignored
whole, with one warning. None of these is a refusal: one task's saved value must
not strand every other task in a loop.

**Turning a saved setting off for one run:** `--no-review` and
`--no-skip-test-gate`. Both resolve as CLI flags, so they outrank the saved
block and `hench.*` alike, and they apply to every task in a loop. `--no-review`
carries the saved `reviewModel` and `reviewOptional` with it. Passing a flag
together with its own negation is an error rather than a guess.

**Previewing it:** `ndx work --task=<id> --resolve .` prints every setting with
the key that supplied it (`task.run` when the saved block won), the task's
`saved` block, and for each setting the saved block won, the `fallback` the
project would have used instead. The `command` it prints is built from flags
alone — saved settings apply to the run but are never written into it, so the
copied command stays correct as the saved block changes.

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

- **Gate passes:** hench marks the task completed with the agent's resolution type and detail, and only then is the work committed with it. A task lands as one commit holding its work and its completion, in that order. When hench commits the work (the commit prompt), the completion is staged into that commit. When the agent already committed for itself, hench folds the completion into the run's last commit, adding the `N-DX-Status` trailer and `N-DX-Item` if it was missing. The fold amends only a commit this run made, not a merge, on no remote, for no other item, with no git operation in progress; otherwise the completion gets a `chore(prd)` record commit of its own and hench prints why. Nothing is written to the PRD after that commit: a commit is tied to its item by the `N-DX-Item` trailer, never by its SHA stored on the item.
- **Gate fails:** the task is not completed on disk or in any commit. The agent's resolution is kept on the run record (`completionHold`) and in the execution log (`completion_not_applied`) for the retry. Review repairs are committed as their own commit on `autoCommit`, or named as left uncommitted otherwise.

Outside a hench run nothing holds a completion, so interactive MCP use and the rex CLI behave as before. A failed gate's record also carries a failure digest (`testGate.failureDigest`): the FAIL lines, the first assertion blocks and the per-suite summary, taken from the whole output so that a long stream of stderr cannot push them out.

### Scoped gate and flake re-run (opt-in)

Two config templates let a project gate less than its whole suite. Both are absent by default, and a repo without them behaves exactly as before. Set them in `.n-dx.json` so they travel with the repo.

```json
"hench": {
  "testGate": {
    "command": "node scripts/run-all-tests.mjs affected {base}",
    "rerunCommand": "node scripts/run-all-tests.mjs {suites}"
  }
}
```

- **`hench.testGate.command`** replaces the gate command. It outranks `hench.fullTestCommand` and auto-detection. `{base}` becomes the commit the run started from (a hex SHA), so the project can test only what the run changed. A template without `{base}` runs as written. If it has `{base}` and no valid start commit is known, hench runs the command it would have run without the template and records `testGate.scopeFallback`.
- **`hench.testGate.rerunCommand`** applies to unattended runs only (`--auto`, `--yes`, no TTY). When the gate fails and its output names the failed suites, hench runs this command once with `{suites}` replaced by those labels, comma-joined. A pass counts as a gate pass and is recorded as a flake; a failure fails the run. There is no re-run after a timeout, when the output names no failed suites, or on an interactive terminal (which offers rerun/abort/skip instead).

- **`hench.testGate.maxWorkers`** is a positive integer, absent by default. Hench passes it as `NDX_TEST_MAX_WORKERS` to the gate and its re-run, post-task tests, the completion test run and the agent's shell, so the project's vitest configs start at most that many workers. Unset leaves the environment as it was. Several worktrees gating at once are otherwise each free to claim every core.
- **`hench.testGate.hostSlot`** is a boolean, `false` by default. When `true`, the gate (each attempt and the re-run), the post-task tests and the completion test run each take the host-wide validation slot, so at most one runs per OS user across all hench processes and worktrees. The timeout starts after admission. An agent's own shell commands are not serialized; bound them with `maxWorkers`. A slot that cannot be taken (an unwritable or full ndx home, a filesystem without hard links) does not skip the tests: the command runs without the slot and a warning names the slot directory and the error. On CLI-provider and API-provider runs alike, Ctrl-C stops a wait and fails the run rather than continuing without a verdict.

  The slot lives in `<ndx home>/validation-slot/<host>/`, where `<host>` is a hash of the machine id (Linux `/etc/machine-id`, macOS `IOPlatformUUID`, Windows `MachineGuid`; the hostname only when the host has no id source), so a network change that renames the host keeps one slot and hosts sharing a network home never share it. A lookup that times out (10 s) or fails transiently does not fall back to the hostname: that validation runs without the slot with a warning naming the lookup, and the lookup is not run again for 60 s. The command hench runs inside the slot gets `NDX_VALIDATION_SLOT` (the token) and `NDX_VALIDATION_SLOT_DIR` (the directory), so a slot acquire it starts nests instead of waiting. Every command hench confines in its sandbox, the vendor CLI session included, gets `NDX_VALIDATION_SLOT_DIR` alone, resolved on the host: an absolute value is the slot directory to use, so a test run started inside the sandbox needs no machine-id lookup there. A Codex session, which runs in its own sandbox, gets it too unless the sandbox setting is off. A vendor CLI session keeps its environment for its whole life, so its spawn waits for a host lookup still running (up to the 10 s lookup limit, and Ctrl-C stops the wait); if the lookup fails, the session starts without the directory, one warning says so, and its test runs resolve the slot themselves. A waiting run prints `Waiting for the validation slot held by pid <n> in <project> since <time> (<path to holder.json>)` about every 30 s. Only an interrupt stops a wait; there is no maximum wait. A holder whose process and test child have exited is reclaimed automatically, and so is a record naming the waiter's own pid with a token it does not hold, unless its test child is still alive. If a holder died without releasing and the OS gave its pid to an unrelated process (Windows reuses pids within moments), every run on the host waits behind that process. To clear the wedged slot, confirm no ndx test run is active, then delete the `holder.json` named in the message.

**Output-line protocol.** The project's runner tells hench what it did with lines in its output. `scripts/run-all-tests.mjs` emits both:

```
test-gate: selected-suites=root,hench
test-gate: failed-suites=hench
```

Labels are comma-separated. Hench reads the last line of each kind from the whole output. A runner that prints neither line still works: it just gets no suite record and no re-run.

**Run-record fields** (`testGate` in `run.json`):

| Field | Meaning |
|-------|---------|
| `base` | The commit `{base}` was replaced with |
| `suites` | Suites the gate selected (`selected-suites=` line) |
| `scopeFallback` | Why the templated command was not used |
| `flakyRerun` | Suites that failed, then passed on the re-run, each with a one-line `firstFailure`. Present only when the re-run passed |
| `firstAttempt` | The original verdict (command, duration, failed suites, selected suites) when the gate was re-run. After a passing re-run the top-level fields describe the re-run |
| `rerun` | The one re-run: command, suites, `passed`, duration, and `error` when it gave no verdict |
| `rerunSkipped` | Why no re-run happened after a failure (no failed-suites line, unsafe label, no `{suites}` placeholder) |
| `queueMs` | Milliseconds spent waiting for the validation slot, summed over the gate and its re-run. Present only with `hench.testGate.hostSlot` on |
| `executionMs` | Milliseconds the gate and its re-run ran inside the slot. Present only with `hench.testGate.hostSlot` on |

The post-task test record carries the same two fields for its run. `hench show <run-id> .` and the end-of-run output print them as `Validation slot: queued <n>s, ran <n>s`.

### Gate-only retry

When the task's previous run failed *only* at the test gate, retrying it no longer starts an agent session. `ndx work --task=<id>` skips the agent, re-records the held completion, re-runs the gate, and applies the completion on green. All of these must hold, otherwise the normal agent path runs:

- the previous run failed, ran the gate and failed it, and holds a completion (`completionHold`);
- it recorded a start commit and committed work, its last commit is in `HEAD`, and the checkout is on the same branch;
- the working tree has nothing dirty beyond PRD bookkeeping and hench artifacts;
- the previous run was not itself a gate-only retry. This is the loop guard: a second gate failure is probably real, so the agent gets to fix it.

The gate diffs from the oldest start commit of the task's runs that is still in `HEAD`, so earlier attempts' work is covered. The run record carries `gateOnlyRetry` (`sourceRunId`, `base`, `commits`). **Review inheritance:** if the source run's review passed with no unrepaired must-fix findings and `HEAD` is still the commit it ended on, the review is copied to the new run with `review.inheritedFrom` set to the source run id. Otherwise review runs as usual.

### Read-only refusal after prior commits

`isReadOnlyRefusal` no longer fires when earlier attempts already committed the task's files. Without this, a retry of committed work hit the refusal and re-spawned the agent cold. When it is suppressed, the rejection names the earlier runs and the two ways forward (retry for a gate-only run, or `ndx rex update <id> --status=completed` after verifying), and diagnostics record `read_only_refusal_suppressed`. If the files are not found in earlier commits, or the earlier start commit cannot be resolved, the refusal fires as before.

### Scoped checks inside a run

The agent brief and the in-hench reviewer are told that the test gate runs after them and CI runs everything, so they run only scoped checks (the package or test files for the diff) and say what they did not run.

## Stuck Detection

If a task fails repeatedly (default threshold: 3 consecutive failures including completion rejections), stuck detection kicks in and moves to the next task. This prevents infinite loops on unfixable tasks.

## Run Records

Each run is saved to `.hench/runs/<run-id>/`:

- `run.json` — metadata, outcome, token usage
- `transcript.jsonl` — full conversation transcript
- `brief.md` — the brief that was sent to the LLM

Two fields on `run.json` say which model ran and why:

- **`weight`** — the tier of the model actually used: `light`, `standard`,
  `heavy`, or `custom` for a model in no tier this project can reach. Not the
  tier `agent.execute` routes to, which is what it recorded before 0.9.0: every
  record said `standard`, including runs an explicit `--model`, a
  `hench.models` pin or a task's saved block had put on the heavy-tier model,
  and `ndx usage` priced them accordingly.
- **`modelSource`** — the setting that chose the model (`cli-flag`,
  `task.run.tier`, `task.run.models`, `hench.models.<vendor>`, an `llm.*` key,
  `vendor-default`), in the same vocabulary `ndx work --resolve` reports. It
  answers "why did this run use that model" without re-deriving the chain
  against config that may since have changed.

### Run verdict

A run that ends in any status other than completed gets a `diagnosis`: a
verdict from fixed rules over the record, its events and its review report,
with no model call. `hench runs diagnose <run-id> [--format=json]` prints it.
A record still at `running` whose process is gone (`check-runs` verdict
`orphaned`) is classified as ending it would record it: `failed`, with the
run-end error. Nothing is saved; a completed run, or a running one whose
process may be alive, is refused.

| Class | Signal | First action |
|-------|--------|--------------|
| `test-gate-new` | The gate's failure digest names a file the run changed; an absolute digest path under the run's worktree is read repo-relative | Follow-up run with the digest, then re-run |
| `test-gate-preexisting` | The digest names only files the run did not change. No baseline runs, so the verdict says the failure is in tests the run did not edit and was not checked on main; it never asserts the failure predates the run | Run the failing tests on main |
| `completion-held` | `completionHold` with outcome `not-applied` (`applied` and `bypassed` are not holds), or `gateOnlyRetry` | `--fresh`, or fix by hand and verify |
| `completion-held` | The completion gate refused on uncommitted work; outranks every rule but `claim-lost` | Commit or discard the uncommitted paths, then verify |
| `review-blocked` | The review left a must-fix finding unrepaired | Follow-up run with the findings |
| `claim-lost` | `claimLost`: another worktree took the task. A `readOnlyRefusal` (the forked attempt made no edits and the task re-ran cold) is never a class; it is one evidence line on the class the rest of the record gives | Release the claim, then re-run |
| `budget-timeout` | `budget_exceeded`, `timeout`, or a brief too large for the context window | Split the task, or raise its tier |
| `vendor-transient` | `error_transient`, or an auth, rate-limit (a CLI session limit included) or transient failure, read from failure events or from `run.error`, so it fires with the event pipeline off | Retry later; for auth, re-authenticate the vendor CLI and re-run |
| `no-changes` | The agent made at least one tool call, and made no commits or changed only PRD files. A run that dies before its first tool call is not `no-changes` | Tighten the done-when |
| `unclassified` | None of the above; never guessed | Read the run log |

`attempt` counts the task's finished runs that did not complete, capped at 2. On
the second attempt the verdict drops every re-run action and leads with a
follow-up fix or a split. The verdict's summary is written as the task's
`failureReason` when it has none, or when its current one is an earlier run's
verdict, so the next brief names the latest cause. A reason a person or the
agent wrote is kept. The dashboard shows the
verdict on the task page behind the `hench.runVerdict` toggle.

### Queue plan

`ndx work --plan-queue [--format=json] .` groups a v2 PRD's ready tasks into
lanes that can run side by side, from fixed rules with no model call. It starts
no run, takes no claim and writes no file.

- A lane holds 1 to 3 tasks of one change, each of effective tier light or
  standard (the task's saved `run.tier`, else its change's, else the tier
  `agent.execute` routes to). A task blocked only by tasks of its own lane runs
  after them.
- Lanes offered together come from changes whose `touches` do not overlap. A
  change with no `touches` never shares the plan with another lane.
- Tasks tagged `review-critical`, `migration` or `cross-package`, on the task
  or its change, are left out: run them on their own.
- At most `guard.maxConcurrentProcesses` minus the runs active now are offered.
  Live runs are counted in every worktree `git worktree list` names for the
  repository, since their lanes share the machine; outside a repository, or when
  git fails, only this worktree is counted and the summary says so. The run
  limiter itself still counts per worktree.

A lane's command runs its tasks one after another in the current checkout
(`ndx work --task=a --auto . && ndx work --task=b --auto .`). Every lane's
command targets `.`, so lane 1 runs here and **each later lane must run in its
own worktree**: two lanes in one checkout collide, the later one meeting the
earlier one's uncommitted edits. While a run is live in this worktree, lane 1
needs its own worktree too. The summary, each such lane's text block and Live's
Ready next say so. An explicit
`--task` ignores blockers, and a run can exit 0 without completing its task (a
transient vendor error), so the step for a blocked task adds
`--require-unblocked`: it refuses to start while any blocker is not completed.
The JSON has
`lanes [{command, changeId, ownWorktree, tasks [{id, title, reason}]}]`
(`ownWorktree` is true for every lane after the first, and for lane 1 while a
run is live in this worktree), `excluded
[{id, title, reason}]`, `activeRuns`, `activeRunsByWorktree [{path, runs}]`,
`runLimit` and `summary`; every ready task
appears once, with its reason. Live shows the plan as Ready next behind the
`hench.readyNext` toggle.
