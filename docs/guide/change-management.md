# Keeping Your PRD Alive

Your PRD starts fresh and accurate. Three months later, completed tasks still sit marked "pending", epics describe features you shipped last quarter, and findings from solved problems keep regenerating. This guide walks through keeping the PRD synchronized with reality — not just at setup, but as your codebase evolves.

## The scenario

You shipped v1.0 six weeks ago. The PRD has 40 tasks — 20 are done, 10 are half-way through, 5 are blocked, and 5 were never relevant. New features went in without updating the PRD. The agent keeps re-proposing fixes for problems you already solved. The PRD has become noise instead of a tool.

This guide covers three maintenance loops:

1. **Post-sprint pruning** — remove completed work, archive what's no longer relevant
2. **Monthly re-analysis** — surface new drift before it compounds
3. **Ongoing acknowledgment** — silence resolved findings so proposals stay relevant

## Understanding PRD drift

PRD drift happens naturally as codebases evolve. It's not a failure — it's a signal that the PRD needs maintenance.

### Common drift patterns

**Completed work left in the PRD:**
- Task marked `pending` but the feature shipped 2 sprints ago
- Epic still shows 3 pending tasks that were actually split and completed piecemeal
- Subtasks marked `in_progress` because the agent was interrupted and you moved on

**Obsolete items:**
- Epic for a feature you've since deprecated
- Epics from RFCs that were rejected or shelved
- Tasks for refactoring that became unnecessary after a redesign

**Orphaned tasks:**
- Features completed outside the PRD (manually, by someone without access, or before n-dx was set up)
- Bugs fixed before they were added to the PRD
- Design debt resolved during feature work

**Stale findings:**
- SourceVision suggests splitting a file you've already split
- Findings from a module you've since rewritten keep regenerating
- Recommendations for problems you've explicitly decided not to fix

### Detecting drift

**Quick health check:**

```sh
ndx status .          # scan for pending/completed mismatches
```

Look for clusters of completed tasks from the same epic. If you see 5 completed from one epic and 3 still pending from that same epic, you likely have some stale pending items.

**Full diagnostic:**

```sh
rex validate .        # check structural integrity
ndx ci .              # full analysis pipeline (may take a few minutes)
```

`rex validate` checks for orphaned items (tasks with no parent, parent-level mismatches, date anomalies).

`ndx ci` runs the full pipeline: re-analyzes the codebase, checks PRD health metrics (completion rate, item age distribution), and generates a report. Read the report for completion percentage, item age stats, and any structural issues flagged.

## The maintenance loop

### Cycle 1: Mark what's actually done

Before pruning, make sure your PRD reflects what's actually shipping.

**Manual sweep (15 minutes per epic):**

For each epic, walk through the pending/in-progress tasks:

```sh
ndx status .
```

For each task, ask: "Is this shipped?" If yes, mark it completed with the resolution type:

```sh
rex update <task-id> --status=completed --resolution-type=code-change
```

Resolution types are:
- `code-change` — you or the agent wrote the code
- `config-override` — resolved by configuration, not code
- `acknowledgment` — you decided not to do it (mark these `deferred` instead)
- `deferred` — explicitly postponed; keep for future reconsideration

**Batch update via dashboard (if you have `ndx start` running):**

Open the dashboard (typically `http://localhost:3117`), navigate to the PRD tree, and mark items complete through the UI. Changes sync to `.rex/prd.json` immediately.

### Cycle 2: Archive completed epics

Once you've marked individual tasks, check if entire epics are done:

```sh
ndx status .          # find completed epics
```

An epic is "done" when all its tasks are either `completed` or `deferred`.

For epics that are fully complete and you won't revisit:

```sh
rex remove <epic-id>
```

This moves the epic to `.rex/archive.json` — a permanent archive that preserves the completed work for audit trails and recovery if needed.

**Recovering from archive (if you need to revisit):**

```sh
rex restore <epic-id>
```

Items in the archive are tagged with their completion timestamp, so you can search the archive for items completed in a specific time window.

### Cycle 3: Re-analyze and surface new drift

Run a fresh analysis to pick up architectural changes:

```sh
ndx analyze .
```

This generates a new `.sourcevision/CONTEXT.md` with updated findings. These findings may be:
- **New problems** from code that changed since the last analysis
- **Resolved problems** from work you've completed (but the findings haven't been acknowledged yet)
- **Persistent problems** that are still there and maybe got worse

Compare the new findings with the old ones. New findings go into the recommendation cycle (see below). Persistent findings that you can't fix belong in the backlog.

### Cycle 4: Propose and acknowledge

Generate recommendations based on the fresh analysis:

```sh
ndx recommend --actionable-only .
```

Review the proposals. For each proposed item, decide:
- **Add it**: accept it into the PRD
- **Acknowledge it**: mark the finding as resolved (you've made a deliberate choice not to fix it), so it won't keep regenerating

If you've already fixed a problem but the finding persists, acknowledge it:

```sh
ndx recommend --acknowledge .
```

You'll be prompted for which findings are resolved. Select the ones you've already fixed. These are marked in `.sourcevision/acknowledged.json` — the next time you run `ndx recommend`, these findings won't be re-proposed.

### Example maintenance session

Here's a complete cycle from start to finish:

```sh
# 0. Create a branch for the maintenance work
git checkout -b chore/prd-maintenance

# 1. Mark what's actually done
ndx status .                                    # review the tree
rex update <task-id> --status=completed --resolution-type=code-change
rex update <task-id> --status=deferred
# ... for each task you've completed

# 2. Remove finished epics
rex remove <epic-id>                            # archive the epic
git add -A && git commit -m "Archive completed epic: Feature X"

# 3. Re-analyze
ndx analyze .
cat .sourcevision/CONTEXT.md | grep -A 20 "findings"

# 4. Propose and filter
ndx recommend --actionable-only .
# Review proposals; accept the ones that matter, skip noisy ones

# 5. Acknowledge resolved findings (don't re-propose them)
ndx recommend --acknowledge .

# 6. Review the cleaned PRD
ndx status .
ndx validate .

# 7. Commit
git add -A && git commit -m "PRD maintenance: updated status, acknowledged findings"
git push -u origin chore/prd-maintenance
```

## Recommended cadence

**Post-sprint (weekly or bi-weekly):**

Time: 10–15 minutes.

Right after a sprint closes, mark completed tasks and remove finished epics. This is the highest-ROI maintenance — the work is fresh in your mind, and you'll catch "actually done but not marked" items before they stack up.

```sh
ndx status .
# (scan and mark)
rex remove <finished-epic-ids>
```

**Monthly deep clean:**

Time: 45 minutes to 1 hour.

Once a month, do the full cycle: mark completion, analyze, recommend, acknowledge. This catches drift before it compounds.

```sh
ndx analyze .
ndx recommend --actionable-only .
ndx recommend --acknowledge .
ndx status .
git diff .rex/prd.json | wc -l          # how many changes?
```

**Quarterly full reset (if PRD drift is high):**

If you go 3+ months without maintenance and the PRD is 50%+ stale, consider a full reset:

```sh
ndx ci .                                        # full analysis + health report
ndx plan --accept .                             # re-analyze and accept all proposals
# This rewrites the PRD from scratch based on current codebase
```

This is safe — the old PRD goes to archive, and you start fresh with a clean analysis. Archive items are available for recovery if needed.

## Identifying and fixing specific drift patterns

### Pattern 1: Completed work not marked

**Signal:** You remember finishing a feature, but the task still shows `pending`.

**Fix:**

1. Find the task: `ndx status . | grep <feature-name>`
2. Review its acceptance criteria against the current codebase
3. If fully met, mark it: `rex update <task-id> --status=completed --resolution-type=code-change`
4. If partially met, edit the task to reflect what's actually pending: `rex update <task-id> --title="<narrower scope>"`

### Pattern 2: Stale epics

**Signal:** An epic describes work from last quarter that you've moved away from.

**Fix:**

1. List the epic's tasks: `ndx status . | grep -A 10 "Epic Name"`
2. Mark its completed tasks as complete
3. If all tasks are done or deferred: `rex remove <epic-id>`
4. If some tasks are still pending but you're deprioritizing them: move to a "backlog" epic or mark them `deferred`

### Pattern 3: Orphaned tasks

**Signal:** You see a task in the PRD, but the code it describes doesn't exist or is already done.

**Fix:**

1. Verify the current state: read the relevant code, search for the described change
2. If already done: mark `completed`
3. If never going to happen: mark `deferred` with a reason, or `remove` entirely
4. If partially done: narrow the task scope and mark what's completed

### Pattern 4: Regenerating findings

**Signal:** You run `ndx recommend` and see the same finding about a module you've already fixed.

**Fix:**

1. Verify the finding is actually resolved: re-read the module, check imports, verify the anti-pattern is gone
2. If resolved: run `ndx recommend --acknowledge .` and mark the finding as acknowledged
3. If not resolved: add the finding to the PRD as a task that didn't get picked up in earlier cycles, or acknowledge that you're living with the anti-pattern deliberately (sometimes acceptable for non-blocking patterns)

## Using `ndx sync` for team-backed PRDs

If your team uses Notion, GitHub discussions, or another external system as the source of truth for your PRD, `ndx sync` keeps your local `.rex/prd.json` in sync with that system.

### Setting up sync

First, configure an adapter:

```sh
ndx config rex.adapter notion .          # or github, airtable, etc.
ndx config rex.adapterUrl https://notion.so/... .
ndx config rex.adapterAuthToken <token> .
```

Adapters vary by platform. Check `ndx config --help` for your platform's required fields.

### Two-way sync

Once configured, sync in either direction:

**Pull from remote (remote is source of truth):**

```sh
ndx sync --pull .
```

Your local PRD is overwritten with what's in the remote system.

**Push to remote (local is source of truth):**

```sh
ndx sync --push .
```

Your local `.rex/prd.json` is pushed to the remote system.

**Full bidirectional sync (latest wins, conflict resolution by timestamp):**

```sh
ndx sync .
```

Items that changed locally and remotely are resolved by timestamp — the latest change wins. Items unique to one side are merged.

### Team workflow with sync

**Scenario 1: You and your team use Notion as the PRD source**

1. Team edits items in Notion (titles, descriptions, priorities)
2. You pull changes locally: `ndx sync --pull .`
3. You run `ndx analyze . && ndx recommend .` based on the updated Notion items
4. You execute with `ndx work .`
5. Task completion and agent runs update your local PRD
6. Push completion back to Notion: `ndx sync --push .`

**Scenario 2: Local CLI for execution, Notion for discussion**

1. Team discusses features in Notion; comments, linked docs, decision history
2. You sync locally to get the latest decisions: `ndx sync --pull .`
3. You execute locally and add your own PRD items from findings: `ndx analyze . && ndx recommend --accept .`
4. Push your PRD additions back to Notion for team visibility: `ndx sync --push .`

### Conflict resolution

If a field was changed both locally and remotely since the last sync, `ndx sync` will:

1. Show the conflict
2. Ask you to resolve it (keep local, keep remote, or merge manually)
3. Apply the resolution to both sides

For large teams, this is rare if you establish a pattern: typically one person (a team lead or tech lead) runs the weekly pruning and sync, and the team makes PRD comments via Notion rather than direct edits.

## Archive management

Every time you run `rex remove <item-id>`, the item goes into `.rex/archive.json`. The archive serves as an audit trail — you can recover items if you change your mind, and you can see what you decided not to pursue.

### Viewing the archive

```sh
cat .rex/archive.json | jq '.items | length'        # how many archived items?
cat .rex/archive.json | jq '.items[] | select(.completedAt != null) | .title' # show completed items
```

### Recovering from archive

```sh
rex restore <item-id>     # restore a specific item
```

The item returns to the PRD tree under its original parent, with all history intact (timestamps, completion status, all metadata).

### Pruning the archive

The archive auto-trims at 100 batches (to prevent unbounded growth). You can also manually clear old items:

```sh
# Clear items archived more than 6 months ago
rex archive-prune --before="6m" .
```

This is safe — archived items are only used for recovery/audit, and they're tagged with timestamps for audit purposes. You rarely need to prune unless the archive file gets very large.

## Common pitfalls and recovery

### Pitfall 1: Over-pruning (removed too much)

You ran `rex remove` on an epic and immediately regretted it.

**Recovery:**

```sh
rex restore <epic-id>
git diff .rex/prd.json                                # see the diff
```

If you committed already:

```sh
git revert <commit-hash>
rex restore <epic-id>
```

### Pitfall 2: PRD drifted so far it's unusable

You haven't done maintenance for 6+ months. The PRD is 80% stale, and it's not worth trying to salvage item-by-item.

**Recovery:**

```sh
ndx analyze .
ndx plan --accept .          # full re-analysis and PRD rewrite
```

This overwrites your PRD based on the current codebase. All old items go to archive. Start fresh.

If you want to preserve some of the old PRD structure before resetting:

```sh
cp .rex/prd.json .rex/prd.backup.json
ndx plan --accept .
# Now .rex/archive.json contains your old items for recovery
```

### Pitfall 3: Findings keep regenerating even after acknowledging

You acknowledged a finding, but `ndx recommend` keeps proposing it.

**Cause:** The finding is coming from a different source (e.g., different SourceVision runs with different configurations, or the code genuinely still has the anti-pattern).

**Fix:**

1. Verify the problem is actually fixed: re-read the code, re-run analysis with `ndx analyze --full .`
2. If fixed: wait for the next `ndx recommend` run — acknowledgment is cached for 30 days before refreshing
3. If not fixed: either fix it properly, or mark it `deferred` in the PRD with an explanation of why you're living with it

## A complete maintenance checklist

**Weekly (post-sprint):**
- [ ] `ndx status .` — scan for completed work not marked
- [ ] `rex update` for each completed task
- [ ] `rex remove` for finished epics
- [ ] `git commit -m "PRD maintenance: marked completed work"`

**Monthly (full cycle):**
- [ ] Run weekly checklist above
- [ ] `ndx analyze .` — re-analyze codebase
- [ ] `ndx recommend --actionable-only .` — review proposals
- [ ] `ndx recommend --acknowledge .` — silence resolved findings
- [ ] `ndx validate .` — check PRD integrity
- [ ] `ndx status .` — confirm the PRD is healthy
- [ ] `git commit -m "PRD maintenance: full cycle re-analysis and acknowledgment"`

**If using external adapters (Notion, GitHub, etc.):**
- [ ] Run the above locally
- [ ] `ndx sync --push .` — push local changes to remote
- [ ] Notify team if significant PRD changes (new epics, priorities changed)

**Quarterly (if PRD is heavily drifted):**
- [ ] `ndx ci .` — full health report
- [ ] Review drift patterns from the report
- [ ] Either do a deep-clean maintenance pass, or reset the PRD with `ndx plan --accept .`

## Next steps

Once your PRD is healthy:

- **Run `ndx work --auto --iterations=N .`** to execute a full sprint autonomously
- **Schedule a recurring maintenance task** with `ndx schedule` to remind yourself to prune monthly
- **Set up `ndx sync`** if your team uses an external system for backlog management
- **Use `ndx self-heal`** for ongoing improvement between full maintenance cycles
