# n-dx v1 PRD

## Vision

n-dx is a CLI toolkit that lets a developer point it at a codebase, generate a structured plan, and execute tasks autonomously — in a loop. The three packages (sourcevision, rex, hench) should feel like one cohesive tool, not three bolted-together CLIs.

v1 goal: a developer at En Dash can run `n-dx plan .` and `n-dx work .` in a loop and get reliable, useful results. The PRD state is the single source of truth and stays in sync.

---

## Epic 1: Natural language PRD authoring (top priority)

Adding items to the PRD should be as easy as describing what you want. The LLM figures out the structure. This is the default behavior — no flags needed.

### Smart add (default behavior)

- `rex add "user authentication with OAuth support"` sends the description to Claude, which determines the right hierarchy: creates an epic, features, tasks, acceptance criteria, priorities — the full breakdown
- The LLM receives the existing PRD as context so it avoids duplicates and fits the new items into the existing structure
- Presents the proposed tree for approval before inserting (same accept flow as `analyze`)
- Scoping under an existing parent: `rex add "add rate limiting" --parent=<epic-id>` constrains the expansion under that epic
- Without a parent, the LLM auto-determines the right placement in the tree
- `rex add task --title="..." --parent=<id>` (explicit level) bypasses the LLM and works as the manual/direct mode

### Bulk natural language input

- `rex add` should accept multiple descriptions: `rex add "auth system" "payment processing" "admin dashboard"`
- Support piping: `echo "build a user settings page" | rex add`
- `rex add --file=ideas.txt` reads a freeform text file of ideas and structures them all at once (distinct from `analyze --file` which imports a formal spec — this is for rough notes and brainstorming)

---

## Epic 2: Reliable work loop

The core value prop is `plan → work → status → work → ...`. Right now hench and rex are wired together but untested as a loop. This epic is about making that loop solid.

### Task selection and state transitions

- `findNextTask` should respect priority ordering and blocked-by dependencies correctly
- When hench picks a task, it must atomically transition to `in_progress` before starting work (both CLI and API providers — currently only CLI does this)
- When a task completes, parent items should auto-update: if all children of a feature are `completed`, the feature should transition to `completed` too
- When hench fails a task, it should be marked `deferred` with a clear error summary in the log, not silently left as `in_progress`

### Run quality and guardrails

- Hench should validate that it actually made meaningful changes before marking a task complete (e.g. check git diff is non-empty, or tests pass)
- Add a `--review` flag to `n-dx work` that shows the agent's proposed changes before committing
- Run records should include a structured summary: files changed, tests run, commands executed
- Cap total token spend per run with a configurable budget (not just max turns)

### Loop continuity

- `n-dx work --loop` mode: after completing a task, automatically pick the next one and continue (with configurable pause between tasks)
- If the agent gets stuck (3+ failed attempts on the same task), skip it and move to the next
- `n-dx work --task=<id>` should error clearly if the task is already completed or deferred

---

## Epic 3: PRD structure and lifecycle

The current epic/feature/task/subtask hierarchy is rigid. It works for generated proposals but is awkward for manual planning and ongoing management.

### Flexible hierarchy

- Allow tasks to exist directly under epics (skip the feature level when it's not needed)
- Support task-to-task dependencies via `blockedBy` (already in schema, but `n-dx work` doesn't respect it fully)
- Add `n-dx rex move <id> --parent=<id>` to reparent items in the tree

### Better task lifecycle

- Add `blocked` as a status (distinct from `deferred`) — a task that can't proceed due to dependencies
- `rex next` should explain why it picked a particular task (priority? unblocked? only option?)
- `rex update` should validate status transitions (can't go from `completed` back to `pending` without explicit `--force`)
- When updating status, auto-timestamp it: track `startedAt`, `completedAt` on items

### PRD quality

- `rex validate` should check for orphaned items (tasks with no parent), circular blockedBy, and items stuck in `in_progress` for too long
- Add `rex prune` to remove completed subtrees (archive them to a separate file)
- Add `rex import` as a synonym for `rex analyze --file` for discoverability

---

## Epic 4: Analyze pipeline

The scanner-based analyze produces noisy, shallow proposals. The new LLM reasoning layer helps but the overall pipeline needs work.

### Scanner improvements

- `scanTests` should group by describe-block nesting, not just file name
- `scanDocs` should ignore auto-generated files (anything in dist/, .sourcevision/, etc.)
- `scanSourceVision` should produce more actionable tasks from zone findings (include file paths, suggested fixes)
- Add a `scanPackageJson` scanner: extract scripts, dependencies, and engine requirements as potential tasks

### LLM refinement

- The `reasonFromScanResults` prompt should include the project's CLAUDE.md or README for context
- LLM should merge near-duplicate scan results (e.g. "Login" from tests + "Login Flow" from docs)
- Add `--model` flag to `rex analyze` to override the default model for LLM reasoning
- Handle large scan result sets by chunking (if > 100 results, batch into multiple LLM calls)

### File import

- `rex analyze --file` should support multiple files: `--file=spec1.md --file=spec2.md`
- Support JSON and YAML input files (not just markdown) — detect format by extension
- When importing, show a diff against existing PRD items before accepting

---

## Epic 5: External sync and Notion integration

The file-based store works for single-developer use. For team use, we need to sync PRD state to external tools, starting with Notion.

### Store adapter architecture

- Define a clean adapter interface that both file and external stores implement
- Adapters should support: CRUD on items, log append, config load/save
- Add adapter registration: `n-dx rex adapter add notion --token=<secret>`
- Sync should be bidirectional: changes in Notion reflect back to local state

### Notion adapter

- Map PRD hierarchy to Notion database: epics as top-level pages, features/tasks as sub-items
- Sync status, priority, description, acceptance criteria, and tags
- Support Notion's native status/priority properties (map to rex equivalents)
- Handle conflict resolution: last-write-wins with a warning log

---

## Epic 6: CLI and developer experience

### Error handling

- All commands should print actionable error messages (not stack traces)
- If `.rex/` doesn't exist, suggest `n-dx init .` instead of crashing
- If claude CLI isn't installed, provide install instructions and fall back gracefully

### Output and formatting

- `n-dx status` should show a progress bar per epic
- `n-dx status --format=tree` should show the full hierarchy with status icons
- `n-dx work` should stream hench output in real-time with clear section headers
- Add `--quiet` flag across all commands for scripting use

### Configuration

- `n-dx config` command to view/edit settings across all three packages
- Support `.n-dx.json` at project root as a unified config (merges into individual package configs)
- Document all config options in `--help` output

---

## Epic 7: Testing and verification

### Acceptance criteria as tests

- PRD tasks with `acceptanceCriteria` should be verifiable: add a `rex verify <id>` command that runs associated test files
- When hench completes a task, it should attempt to run the relevant tests automatically
- `rex status` should show test coverage per task (if acceptance criteria map to test files)

### CI integration

- Add `n-dx ci` command that runs `sourcevision analyze → rex validate → report`
- Output a machine-readable report (JSON) of PRD health for CI dashboards
- Fail CI if there are validation errors or orphaned items
