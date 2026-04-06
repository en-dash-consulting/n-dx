---
name: triage
description: Triage GitHub issues — prioritize, reprioritize, and identify consolidation candidates using the strategic goals matrix
---

Triage open GitHub issues against the project's strategic goals matrix. Prioritize unprioritized issues, flag misprioritized ones, and identify issues that should be merged or consolidated.

## Setup

Load the strategic goals matrix from `.claude/skills/triage/goals.json`. This file defines:
- `project` — GitHub org, repo, and project board number
- `strategic_goals` — weighted themes with keyword lists (higher weight = higher strategic importance)
- `label_weights` — how issue labels factor into scoring (bugs score higher than enhancements)
- `priority_levels` — the P0/P1/P2 scale used on the GitHub Project board

## Step 1: Gather data

Fetch all data in parallel where possible:

1. **Open issues with bodies**: Run `gh issue list --repo {owner}/{repo} --state open --json number,title,body,labels,comments,createdAt,updatedAt --limit 200`
2. **Project board items with priorities**: Run `gh project item-list {project_number} --owner {owner} --format json --limit 200` to get current P0/P1/P2 assignments and statuses
3. Cross-reference issues to project items by title to determine each issue's current priority (or lack thereof)

## Step 2: Score each issue

For each open issue, compute a relevance score:

### Goal alignment (primary signal)
For each strategic goal, check if the issue's **title + body + comment text** contains any of the goal's keywords (case-insensitive). The match score for a goal = `goal.weight * number_of_distinct_keywords_matched`. Sum across all goals for the total goal-alignment score.

Use semantic judgment, not just literal keyword matching — an issue about "ndx init fails on Windows" aligns with both "user-onboarding" and "platform-support" even if it doesn't use the exact keyword "onboarding."

### Label weight (secondary signal)
Sum the `label_weights` values for each label on the issue.

### Staleness (tertiary signal)
Issues open longer than 30 days get a small bump (+1). Longer than 90 days get +2. This prevents old issues from being perpetually deprioritized.

### Bug boost
Issues labeled `bug` that describe data loss, corruption, or security issues get an additional +3 on top of the label weight.

### Composite score → priority bucket
- **P0**: Score >= 12, or any issue matching the highest-weighted goal with 3+ keyword hits
- **P1**: Score >= 6
- **P2**: Score < 6

These thresholds are guidelines — use judgment. A low-scoring issue that blocks a P0 issue should be escalated. A high-scoring issue that's purely speculative/aspirational can be downgraded.

## Step 3: Identify consolidation candidates

Group issues by their dominant strategic goal theme. Within each group, look for:

1. **Duplicates**: Issues describing the same problem from different angles (e.g., two issues about CLI help text confusion)
2. **Subsumption**: One issue is a strict subset of another (e.g., "Windows install fails" is subsumed by "Windows holistic usability")
3. **Siblings that should be an epic**: Multiple small issues in the same theme that would be better tracked as subtasks under a single umbrella issue

For each consolidation candidate, note:
- Which issues to merge
- Which one should survive (or if a new umbrella issue should be created)
- Why they overlap

## Step 4: Present findings as an HTML report

**Always generate a self-contained HTML file** at `/tmp/triage-report.html` and open it in the browser (`open /tmp/triage-report.html`). Do not dump the full report as text into the conversation.

The HTML report should be a dark-themed, tabbed interface with these sections:

### Summary bar
Show key stats: total open issues, current P0/P1/P2 counts, unprioritized count.

### Tab: Consolidation recommendations
Each consolidation group as a card showing:
- Group theme name and issue count reduction (e.g., "9 issues → 3")
- Each issue with its number (linked to GitHub), title, and merge recommendation (keep, merge into #N, etc.)

### Tab: Unprioritized issues
Grouped by recommended priority (P0, P1, P2). Each issue shows:
- Issue number (linked to GitHub) and title
- Recommended priority badge
- Strategic goal theme tags
- Brief rationale
- Confidence level (HIGH/MED/LOW)

### Tab: Reprioritization candidates
Split into "Upgrade" and "Downgrade" groups. Each issue shows:
- Issue number (linked to GitHub) and title
- Current priority → recommended priority with arrow
- Rationale for the change

### Tab: Confirmed
Summary counts of aligned issues per priority level. Also surface any goal gaps detected (clusters of issues not matching any strategic goal).

### Design notes
- Use GitHub-dark color palette (bg: #0d1117, surface: #161b22, borders: #30363d)
- P0 = red (#f85149), P1 = amber (#d29922), P2 = blue (#58a6ff)
- Issue numbers should link to `https://github.com/{owner}/{repo}/issues/{number}`
- Include a prominent "DRY RUN" banner at the top
- Keep it self-contained (no external CSS/JS dependencies)

## Step 5: Apply changes

After the user reviews and confirms:

1. **Consolidation**: For approved merges, add a comment on the issue being closed referencing the surviving issue, then close it. Use:
   - `gh issue comment {number} --repo {owner}/{repo} --body "Consolidated into #{surviving}"`
   - `gh issue close {number} --repo {owner}/{repo}`

2. **Priority changes**: For approved priority assignments/changes, update the project board field:
   - First get the item ID: `gh project item-list {project_number} --owner {owner} --format json` and find the item
   - Then update: `gh project item-edit --project-id {project_id} --id {item_id} --field-id {priority_field_id} --single-select-option-id {priority_option_id}`
   - Use the field/option IDs from goals.json's project config

3. Report a summary: how many issues were prioritized, reprioritized, and consolidated.

## Important notes

- **Dry-run by default.** This skill is read-only unless the user explicitly asks to apply changes. Present all recommendations as a report. Do NOT run any `gh issue close`, `gh issue comment`, `gh project item-edit`, or any other write command against GitHub unless the user explicitly says to apply specific changes (e.g., "apply all", "apply the P0 changes", "go ahead and close #72"). A general "looks good" or "yeah" in response to the report is NOT permission to write — the user must specifically direct you to apply.
- **Batch confirmations are fine.** When the user does grant permission, they can approve all recommendations at once or cherry-pick individual ones.
- **Explain your reasoning.** For each recommendation, briefly state which strategic goal(s) drove the decision. This helps the user calibrate the goals matrix for next time.
- **Flag goal gaps.** If you notice a cluster of issues that don't match any strategic goal well, suggest a new goal theme the user might want to add to goals.json.
- **The matrix is advisory.** The user's judgment overrides the computed score. If they disagree with a recommendation, that's signal to adjust goals.json weights or keywords, not to argue.
