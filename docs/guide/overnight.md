# Run While You Sleep

n-dx can work through your backlog autonomously while you're away. This guide walks through setting up an overnight run: configuring guardrails, launching the agent, monitoring it safely, and reviewing what happened in the morning.

## The scenario

You have a PRD with 15 pending tasks. It's 9pm. You want the agent to work through as many as it can overnight — but you don't want to wake up to a $200 API bill or a codebase full of half-baked commits. This guide covers exactly that.

## Before you start

### 1. Your PRD should be in good shape

Hench picks tasks from your PRD. If the PRD is sparse or full of vague tasks, overnight results will be poor. Before leaving the agent to run unattended:

```sh
ndx status .           # review what's pending
ndx work --dry-run .   # preview the brief for the next task
```

The `--dry-run` flag shows you the brief that would be sent to the LLM — acceptance criteria, relevant files, codebase context — without executing anything. Read a few to confirm the tasks are well-scoped and the agent will have the information it needs.

### 2. Set a token budget per task

By default, hench uses whatever the global model limit is. Before an overnight run, set an explicit budget so a single stuck task can't consume everything:

```sh
ndx config hench.maxTokens 80000 .    # token ceiling per task run
ndx config hench.maxTurns 40 .        # max tool-use turns per task
```

`maxTokens` caps how much a single task can spend. `maxTurns` limits the number of tool calls (file reads, shell commands, edits) in one run. Both are per-task limits — they reset when the agent moves to the next task.

Reasonable starting values for overnight runs:

| Budget type | Conservative | Balanced | Aggressive |
|------------|-------------|---------|-----------|
| `maxTokens` | 50 000 | 100 000 | 200 000 |
| `maxTurns` | 25 | 40 | 60 |

If you're using the API (not CLI mode), you can also set a hard spend limit in your provider's dashboard — this is your last line of defense.

### 3. Scope to an epic (optional but recommended)

Rather than letting the agent pick any pending task, scope it to one epic. This keeps changes coherent and limits blast radius:

```sh
ndx work --epic="Auth System" --auto --iterations=10 .
```

The agent will only pick tasks from the "Auth System" epic (matched by substring). If that epic runs out of tasks before the iteration limit, it stops cleanly.

## Launch: the overnight command

### Option A: background server + foreground agent

Start the dashboard server in the background, then run the agent in the foreground of a terminal you'll leave open (tmux or screen):

```sh
# Terminal 1 — leave it running
ndx start --background .

# Terminal 2 — the overnight agent (in tmux/screen)
ndx work --auto --iterations=20 .
```

The dashboard server (`ndx start`) lets you check progress from a browser without interfering with the agent. The two can run concurrently safely — hench writes only to `.hench/runs/` and makes small, atomic PRD status updates that the server self-corrects from within seconds.

### Option B: foreground only (no dashboard)

If you don't need the dashboard, skip `ndx start` and just run the agent:

```sh
ndx work --auto --iterations=20 .
```

### Choosing an iteration count

There's no perfect formula, but a rough guide:

- **Short tasks** (docs, config, small refactors): 1–2 minutes each → 20 iterations overnight is ~40 minutes of work
- **Medium tasks** (feature implementation, test suites): 5–10 minutes each → 8–12 iterations fills a night
- **Long tasks** (complex features, migrations): 15–30 minutes each → 4–6 iterations is plenty

Err on the side of fewer iterations with a higher `maxTokens` than more iterations with a low budget. A task abandoned mid-way due to token exhaustion is harder to recover than one that wasn't started.

### Setting an iteration limit you're comfortable with

Estimate your spend ceiling first:

```
maxTokens × iterations × (cost per 1K tokens) = upper bound
```

For example: 100 000 tokens × 10 iterations × $0.003/1K = **$3.00 worst case**. This math assumes every task hits the ceiling, which won't happen in practice, but it's a safe upper bound for planning.

## Safe concurrency: what can run alongside what

While the agent is running, some operations are safe and some will corrupt your PRD. Follow these rules:

**Safe alongside `ndx work`:**
- `ndx status .` — read-only, always safe
- `ndx start .` / `ndx start --background .` — dashboard reads `.rex/prd.json`; small hench updates self-correct within seconds
- `hench status .` — read-only status check
- `ndx usage .` — read-only analytics

**Unsafe alongside `ndx work` — do not run:**
- `ndx plan .` or `ndx plan --accept .` — both write `.rex/prd.json`; concurrent writes cause data loss
- `ndx ci .` — writes `.sourcevision/` and `.rex/prd.json`
- `ndx analyze .` — writes `.sourcevision/`
- `ndx recommend --accept .` — writes `.rex/prd.json`
- `ndx self-heal .` — orchestrates all of the above

The rule: any command that writes to `.rex/prd.json` or `.sourcevision/` must not run while hench is active. The MCP write tools (`rex_add`, `rex_update`, etc.) have the same constraint — don't use them while the agent is running.

## What happens if a task fails

Hench has built-in stuck detection. If a task fails three consecutive times (including completion rejections), the agent skips it and moves to the next task. You won't get an infinite loop on a broken task.

Tasks marked `failing` are left in the PRD for you to review. The agent moves on.

If the agent process itself is interrupted (power loss, SSH disconnect, Ctrl-C), the current task's run is recorded with whatever progress was made. The PRD status for that task will remain `in_progress` — you'll want to reset it manually in the morning.

## Morning after: reviewing what happened

### Quick summary

```sh
ndx status .           # see which tasks completed overnight
hench status .         # recent runs with outcomes
ndx usage .            # total token spend
```

### Inspect individual runs

```sh
hench status .         # lists runs with IDs, task names, outcomes
hench show <run-id> .  # full transcript for a specific run
```

Run records are in `.hench/runs/<run-id>/`:
- `run.json` — outcome (`completed` / `failed`), token usage, timestamps
- `brief.md` — the brief the agent was given
- `transcript.jsonl` — every tool call and model turn

### Review commits

The agent commits its own work. Review what landed:

```sh
git log --oneline -20   # commits from the overnight run
git diff HEAD~5         # diff the last 5 commits together
```

If a commit looks wrong, revert it before doing anything else:

```sh
git revert <commit-sha>
```

### Handle partial or failed runs

**Task still shows `in_progress`:** The agent was interrupted mid-task. Reset it so it can be retried:

```sh
rex update <task-id> --status=pending
```

Or use the dashboard's task editor if the server is running.

**Task shows `failing`:** Open the run transcript to understand why:

```sh
hench show <run-id> .
```

Common causes:
- Acceptance criteria too vague — the agent can't tell when it's done
- Task requires information not in the codebase (external credentials, human decisions)
- A dependency task wasn't completed first

Fix the PRD item or acceptance criteria, then retry:

```sh
ndx work --task=<task-id> .
```

**Unexpected code changes:** If a commit looks off, read the brief and transcript. The brief tells you what the agent was trying to do; the transcript shows every step it took. This usually reveals whether the task was under-specified or the agent went off-track.

### Reset the server cache (if you ran `ndx start --background`)

After a bulk run that writes many tasks to the PRD, restart the server to flush its in-memory cache:

```sh
ndx start stop .
ndx start --background .
```

This isn't strictly required — the server self-corrects on reads — but it gives you a clean slate for the morning's work.

## A complete overnight checklist

**Before leaving:**
- [ ] `ndx status .` — confirm PRD tasks are well-scoped
- [ ] `ndx work --dry-run .` — preview the next task brief
- [ ] `ndx config hench.maxTokens 100000 .` — set token ceiling per task
- [ ] `ndx config hench.maxTurns 40 .` — set turn limit per task
- [ ] Set a spend cap in your API provider's dashboard
- [ ] `ndx start --background .` — start dashboard (optional)
- [ ] Launch `ndx work --auto --iterations=N .` in tmux or screen

**In the morning:**
- [ ] `ndx status .` — see what completed
- [ ] `ndx usage .` — review token spend
- [ ] `git log --oneline -20` — review commits
- [ ] `hench status .` — check for failed runs
- [ ] Reset any stuck `in_progress` tasks to `pending`
- [ ] Restart server if needed: `ndx start stop . && ndx start --background .`
