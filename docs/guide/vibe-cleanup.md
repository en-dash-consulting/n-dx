# Cleaning Up a Vibe-Coded App

You built something fast. It works, but the code is tangled: no tests, circular dependencies, files in the wrong places, logic scattered across layers. This guide takes you from "it runs but it's a mess" to a structured remediation plan executing autonomously.

## The scenario

You shipped quickly — MVP, hackathon, prototype that became production. Now the codebase has:

- Files that grew to 600 lines and never got split
- No separation between UI, business logic, and data access
- Zero test coverage
- Circular imports that make the bundler angry
- Dead code from abandoned experiments

You don't have time to rewrite it from scratch, but you can't keep adding features to this foundation. The goal: surface the worst problems, build a prioritized cleanup plan, and start executing it today.

## Step 1: Analyze the codebase

First, let n-dx see what's there:

```sh
ndx init .          # first time only — creates .sourcevision/, .rex/, .hench/
ndx analyze .       # full codebase scan
```

`ndx analyze` runs SourceVision to build a structural model of your codebase: files, imports, zones, React components, and architectural findings. For large codebases (10k+ files), this takes a few minutes. For most vibe-coded projects it's under 60 seconds.

After analysis, two artifacts are ready:
- `.sourcevision/CONTEXT.md` — human-readable codebase summary
- `.sourcevision/manifest.json` — machine-readable analysis data

Read the summary quickly to orient yourself:

```sh
cat .sourcevision/CONTEXT.md
```

Look at the findings section — these are the architectural problems SourceVision detected.

### Speeding up large codebases

If your project is large and you want a faster first pass:

```sh
ndx analyze --lite .   # faster scan, fewer enrichment passes
```

Use `--lite` to get findings quickly, then `ndx analyze --full .` overnight once you're confident in the setup.

## Step 2: Read the findings

SourceVision findings come in several types. For a cleanup sprint, not all of them deserve the same attention.

### Finding types and how to read them

| Type | What it means | Cleanup priority |
|------|--------------|-----------------|
| `anti-pattern` | Architectural violation — bidirectional coupling, circular imports, god files | **High** — these compound over time |
| `suggestion` | Concrete improvement recommendation — split this file, extract this module | **Medium** — clear action, bounded scope |
| `move-file` | File is in the wrong zone based on its imports | **Medium** — low risk to fix, high structural benefit |
| `observation` | Metric description — "cohesion is 0.3", "this zone has 14 files" | **Low** — informational, not actionable by itself |
| `pattern` | Detected code structure — not a problem, just a description | **Low** — context, not a task |

Focus on `anti-pattern` findings first. Circular dependencies and god objects actively block future work. Fix those before cleaning up file placement.

### Reading cohesion and coupling scores

The zone map in `.sourcevision/CONTEXT.md` includes cohesion (0–1) and coupling (0–1) scores for each detected zone:

- **Low cohesion (< 0.5)** — files in this zone don't import each other much; the zone may be an accidental grouping rather than a coherent module
- **High coupling (> 0.5)** — this zone imports from many others; changes here ripple widely
- **Both low cohesion and high coupling** — dual-fragility zone, highest structural risk, fix these first

A brand-new vibe-coded project often has one or two large zones with cohesion near zero and coupling near one — that's the "everything is in `src/`" problem. These are your top targets.

### Distinguishing signal from noise

SourceVision can generate dozens of findings. Before building a remediation plan, ask for each finding:

1. **Will this block a future feature?** Circular imports will. A file being 10 lines longer than average probably won't.
2. **Is the fix bounded?** "Extract this class" is bounded. "Improve overall architecture" is not.
3. **Can an agent do this autonomously?** Renaming files and updating imports: yes. Redesigning data models: probably not without a human in the loop.

Filter for findings where all three answers are yes. Everything else goes in a "later" bucket.

## Step 3: Generate a remediation plan

With the analysis done, generate PRD proposals from the findings:

```sh
ndx recommend .
```

This reads the SourceVision findings and proposes actionable PRD items — epics, features, tasks — organized by priority. The proposals are shown for review before anything is written to the PRD.

The output looks like:

```
Proposals (12 items):

  [epic] Code Structure Cleanup (4 tasks)
    [task] Break up src/api.ts into route handlers and business logic
    [task] Extract database access from src/components/UserProfile.tsx
    [task] Resolve circular dependency between auth/ and user/
    [task] Move utility functions from src/index.ts to src/utils/

  [epic] Test Coverage (3 tasks)
    ...

Accept these proposals? [y/n/edit]
```

Read through them before accepting. The proposals are generated from findings — their quality depends on finding quality. Watch for:

- **Vague tasks** ("improve code quality in auth module") — reject or edit before accepting
- **Duplicate work** — two proposals targeting the same problem from different angles
- **Out-of-scope scope creep** — proposals for new features when you asked for cleanup only

### Filtering to actionable findings only

Use `--actionable-only` to skip observation and pattern findings and focus on concrete problems:

```sh
ndx recommend --actionable-only .
```

This reduces noise significantly for a typical vibe-coded codebase.

## Step 4: Scope the sprint

You don't have to accept everything. Vibe-coded codebases often have 30+ findings. Trying to fix all of them in one sprint is a recipe for a months-long cleanup that never ships.

### Accepting a subset

Review each proposed epic and decide: **now**, **next sprint**, or **defer indefinitely**. Then accept only what's in scope for now:

```sh
ndx recommend --accept .    # prompts for each epic individually
```

At the epic level, you can accept some and skip others. Tasks within an accepted epic can also be removed after acceptance:

```sh
ndx status .                            # see what was accepted
rex remove <task-id>                    # remove out-of-scope tasks
rex update <task-id> --status=deferred  # defer but keep for later
```

### Setting scope limits

A realistic cleanup sprint for a medium-sized vibe-coded project:

| Scope | Time estimate | Task count |
|-------|--------------|-----------|
| Circular import removal | 1–2 hours | 3–5 tasks |
| God file decomposition | 2–4 hours | 4–8 tasks |
| Test coverage for core logic | 4–8 hours | 6–12 tasks |
| Full structural cleanup | Days–weeks | 20+ tasks |

Pick one or two of these, not all of them. A tight scope executed cleanly beats a sprawling scope partially completed.

### Adding your own tasks

If you know about problems that SourceVision didn't detect (logic errors, UX debt, missing documentation), add them directly:

```sh
ndx add "Extract payment logic from checkout controller" .
ndx add "Write integration tests for the order flow" .
```

Or import from a notes file you've been keeping:

```sh
ndx add --file=tech-debt-notes.md .
```

These get added with duplicate detection — if SourceVision already proposed something similar, you'll be prompted to merge rather than create a duplicate.

## Step 5: Review and tighten the plan

Before executing, validate that the plan is actually executable:

```sh
ndx status .      # review the full tree
ndx validate .    # check structural integrity
```

For each task, ask:
- Does it have at least 2 concrete acceptance criteria?
- Can a developer (or agent) tell when it's done?
- Is the scope small enough to complete in one focused session?

### Hardening weak tasks

A task like "clean up the auth module" will fail silently — the agent won't know when to stop. Tighten it:

```sh
rex update <task-id> --title="Extract JWT verification logic from auth/index.ts into auth/jwt.ts"
rex update <task-id> --criteria="jwt.ts exports verifyToken and signToken; auth/index.ts has no JWT logic; all existing tests pass"
```

Or delete it and re-add with better definition:

```sh
rex remove <task-id>
ndx add "Extract JWT verification logic from auth/index.ts into auth/jwt.ts — auth/index.ts should only handle routing, jwt.ts should contain verifyToken and signToken" .
```

## Step 6: Execute the cleanup

### Option A: Manual `ndx work` loop (recommended for first cleanup)

Execute one task at a time, reviewing each result before proceeding:

```sh
ndx work --dry-run .          # preview the first task brief
ndx work .                    # execute it
git diff HEAD~1               # review the commit
ndx work .                    # next task
```

This gives you full visibility into what the agent is doing. For cleanup work — especially structural changes — this is the right default. A refactoring that looks correct may break something non-obvious.

### Option B: `ndx self-heal` (recommended for ongoing improvement)

`ndx self-heal` runs a full analyze → recommend → execute cycle automatically:

```sh
ndx self-heal .       # one cycle: analyze → recommend → execute → acknowledge
ndx self-heal 3 .     # three cycles
```

Each cycle:
1. **Analyzes** the codebase (re-runs SourceVision to pick up changes from the previous cycle)
2. **Recommends** new actionable findings (filters out already-acknowledged ones)
3. **Executes** the highest-priority task
4. **Acknowledges** completed findings so they don't regenerate next cycle

The key difference from a manual loop: self-heal re-analyzes between cycles. As you fix architectural problems, the zone structure changes and new findings may emerge. Self-heal adapts to that; a one-time `ndx recommend --accept` followed by `ndx work` runs against a static snapshot.

**When to use self-heal vs manual loop:**

| Situation | Use |
|-----------|-----|
| First cleanup session, unfamiliar codebase | Manual `ndx work` loop |
| Ongoing maintenance after initial cleanup | `ndx self-heal` |
| You want to review each change | Manual loop |
| Overnight or unattended execution | `ndx self-heal N` |
| Specific task list you've curated | Manual loop with `--task=ID` |
| Continuous improvement across many small findings | `ndx self-heal` |

### Option C: Scoped autonomous run

If you've curated the PRD carefully and trust the scope, run the full cleanup sprint unattended:

```sh
ndx work --auto --iterations=10 --epic="Code Structure Cleanup" .
```

This picks tasks only from the named epic, up to 10 iterations. When the epic is exhausted or the iteration limit is hit, it stops cleanly.

See the [overnight operation guide](./overnight.md) for token budgets and safety guardrails before running unattended.

## Step 7: Verify and iterate

After each execution batch, re-analyze to see what changed:

```sh
ndx analyze .
ndx status .
```

The zone map in the updated `CONTEXT.md` will show cohesion and coupling scores after the fixes. If a circular import was removed, coupling scores for the affected zones should drop. If a god file was split, you'll see new zones emerge.

Re-run `ndx recommend` to see if the fixes exposed new issues:

```sh
ndx recommend --actionable-only .
```

It's normal for cleanup to reveal more cleanup. Fixing one circular import often surfaces others that were hidden by the first. Set a scope boundary and stick to it — don't let "while I'm in here" turn a two-day sprint into a month.

## One-session fast path

From zero to executing cleanup:

```sh
ndx init .                                # setup (first time only)
ndx analyze .                             # 1–5 minutes
cat .sourcevision/CONTEXT.md              # read findings
ndx recommend --actionable-only .         # review proposals
ndx recommend --actionable-only --accept . # accept cleanup scope
ndx status .                              # confirm the plan
ndx validate .                            # check integrity
ndx work --dry-run .                      # preview first task
ndx work --auto --iterations=5 .          # execute
```

Total: 15–30 minutes to go from a messy codebase to executing the first cleanup tasks.

For a codebase you want to hand off to `ndx self-heal` for ongoing improvement:

```sh
ndx init .
ndx analyze .
ndx recommend --actionable-only --accept .   # seed the PRD with findings
ndx self-heal 3 .                            # three improvement cycles
ndx analyze .                                # see what changed
```

## Common patterns and pitfalls

### The PRD fills with noise

If `ndx recommend` generates 40 proposals and most look like low-value cleanup, run it with `--actionable-only` and review more aggressively. Accept only the findings where you can imagine the agent writing the fix in under 30 minutes.

### The agent makes changes that break things

For cleanup work, always run tests in the agent's task definition. A refactoring task without "all existing tests pass" in the acceptance criteria will produce structurally correct but functionally broken code. Include test commands in acceptance criteria:

```
rex update <task-id> --criteria="Module extracted; imports updated; pnpm test passes"
```

### Findings keep regenerating

If the same finding appears after you've fixed it, use `--acknowledge` to mark it resolved:

```sh
ndx recommend --acknowledge .    # acknowledge completed findings
```

Self-heal does this automatically (`--acknowledge-completed`). In a manual loop, run this after each batch of fixes.

### The cleanup scope keeps growing

Set a timebox before you start: "This sprint is 8 hours of agent time." Use iteration limits to enforce it:

```sh
ndx work --auto --iterations=8 .    # one hour per task estimate → ~8 hours
```

When the iterations are done, stop. Review what changed, defer the rest, and decide if another sprint is warranted. A partial cleanup that ships beats a complete cleanup that never finishes.
