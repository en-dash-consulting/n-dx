# Skills Reference

Skills are workflow shortcuts installed into your assistant's skill directory by `ndx init`. Typing `/skill-name` in a Claude Code or Codex session invokes the skill and its step-by-step instructions run as a tool-use loop.

Skill files live at:

| Assistant | Directory | Format |
|-----------|-----------|--------|
| Claude Code | `.claude/skills/<name>/SKILL.md` | YAML frontmatter + markdown body |
| Codex | `.agents/skills/<name>/SKILL.md` | YAML frontmatter + markdown body |

The canonical skill definitions are in `packages/core/assistant-assets/skills/`. Running `ndx init` regenerates and overwrites the per-assistant copies from that source.

---

## Skill Inventory

The table below is derived from [`packages/core/assistant-assets/manifest.json`](https://github.com/en-dash-consulting/n-dx/blob/main/packages/core/assistant-assets/manifest.json).

| Skill | Purpose | Invoke |
|-------|---------|--------|
| [`no-plan-mode`](#no-plan-mode) | Prevent plan-mode stalls in autonomous hench runs | Always active in `ndx work --auto` |
| [`ndx-plan`](#ndx-plan) | Analyze the codebase and propose PRD updates | `/ndx-plan` |
| [`ndx-status`](#ndx-status) | Show project status combining PRD progress and codebase health | `/ndx-status` |
| [`ndx-capture`](#ndx-capture) | Capture a requirement, feature idea, or task from conversation context | `/ndx-capture [description]` |
| [`ndx-zone`](#ndx-zone) | Deep-dive into an architectural zone's structure and health | `/ndx-zone [zone-id]` |
| [`ndx-work`](#ndx-work) | Pick up a task from the PRD and begin working on it | `/ndx-work [task-id]` |
| [`ndx-config`](#ndx-config) | View or change n-dx configuration with guided assistance | `/ndx-config [key] [value]` |
| [`ndx-reshape`](#ndx-reshape) | Restructure the PRD hierarchy — regroup epics, change levels, merge overlaps | `/ndx-reshape` |
| [`ndx-feedback`](#ndx-feedback) | Submit feedback, bug reports, or feature requests for n-dx | `/ndx-feedback [description]` |

---

## Skill Details

### no-plan-mode

**Purpose:** Prevents the assistant from entering plan-only mode during autonomous hench runs, which would stall the execution loop waiting for user approval.

**When it triggers:** This skill is embedded in the hench system prompt for all CLI-provider runs (`ndx work --auto`, `ndx work --loop`, `ndx self-heal`, etc.). It is always active during autonomous execution — you do not invoke it manually.

**What it does:** Instructs the assistant to make implementation decisions immediately based on existing code patterns and project conventions, document ambiguity via `append_log`, and proceed rather than stall.

**Customization:** If you want to relax the constraint for a specific run, pass `--permission-mode=plan` to `ndx work`. To change the default for your project, set `hench.permissionMode` in `.n-dx.json`.

---

### ndx-plan

**Purpose:** Analyze the codebase and propose new PRD items to fill gaps between the current state and the desired product direction.

**When it triggers:** Invoke manually with `/ndx-plan` when you want a fresh analysis-driven proposal session. Equivalent to running `ndx plan` from the terminal but interactive within the chat window.

**What it does:**
1. Calls `get_overview` and `get_findings` (sourcevision MCP) to assess current state
2. Calls `get_prd_status` (rex MCP) to avoid duplicating existing items
3. Calls `get_next_steps` for prioritized recommendations
4. Proposes new epics/features/tasks and creates them via `add_item` after approval

**Customization:** Edit `.claude/skills/ndx-plan/SKILL.md` to focus proposals on specific product areas or add domain-specific analysis steps. Note that `ndx init` will overwrite this file — see [Adding your own skill](#adding-your-own-skill) for a durable approach.

---

### ndx-status

**Purpose:** One-command health dashboard: PRD completion progress + codebase quality metrics + recommended next action.

**When it triggers:** Invoke manually with `/ndx-status`. Use it at the start of a session to orient yourself, or after a batch of work to see what changed.

**What it does:**
1. Calls `get_prd_status` (rex MCP) for completion stats
2. Calls `get_overview` and `get_findings` (sourcevision MCP) for codebase metrics and active issues
3. Calls `health` (rex MCP) for structure health score
4. Calls `get_next_task` (rex MCP) to surface the recommended next action
5. Presents a unified report

**Customization:** Extend the skill body to include custom metrics, alerts on specific findings, or integration with external status systems.

---

### ndx-capture

**Purpose:** Turn a freeform description — from the conversation or as an argument — into a structured PRD item placed in the right spot in the hierarchy.

**When it triggers:** Invoke with `/ndx-capture` or `/ndx-capture <description>`. Use it whenever you want to quickly log a requirement without leaving the chat.

**What it does:**
1. Uses the provided description or reviews recent conversation for captured requirements
2. Calls `get_prd_status` (rex MCP) to understand current structure
3. Determines level (epic / feature / task) and finds an appropriate parent
4. Drafts the item with title, description, and acceptance criteria
5. Presents to the user for confirmation, then creates via `add_item`
6. Wires `blockedBy` edges if ordering relationships exist

**Customization:** Modify the skill body to add custom fields, enforce acceptance criteria templates, or auto-assign tags based on keywords.

---

### ndx-zone

**Purpose:** Deep-dive into the structure, health, and cross-zone dependencies of a specific architectural zone detected by sourcevision.

**When it triggers:** Invoke with `/ndx-zone` (prompts you to pick a zone) or `/ndx-zone <zone-id>` to target a specific zone directly.

**What it does:**
1. If no zone-id given, calls `get_overview` and lists zones
2. Calls `get_zone` (sourcevision MCP) for full zone details
3. Reads `.sourcevision/zones/<zone-id>/context.md`
4. Calls `get_findings` filtered to the zone
5. Calls `get_imports` for cross-zone dependency edges
6. Presents cohesion/coupling metrics, key files, and active findings

**Customization:** Add domain-specific checks to the zone report, such as asserting that specific files belong to specific zones or flagging zones that exceed a cohesion threshold.

---

### ndx-work

**Purpose:** Guided task execution: pick up the next PRD task, build a work plan, implement it following the project's execution discipline, and mark it complete.

**When it triggers:** Invoke with `/ndx-work` (picks next task) or `/ndx-work <task-id>` (specific task). Use this for interactive, human-supervised task execution in contrast to `ndx work --auto` which runs unattended.

**What it does:**
1. Reads `.rex/workflow.md` for execution discipline (TDD, validation, commit conventions)
2. Calls `get_item` or `get_next_task` (rex MCP) for task details
3. Calls `get_file_info`, `get_imports`, `get_zone` (sourcevision MCP) to understand context
4. Presents a work plan for user approval
5. Marks task `in_progress`, implements, runs tests, commits, marks `completed`
6. Calls `append_log` with decisions and outcomes

**Customization:** The execution workflow is defined in `.rex/workflow.md` (project-specific) rather than in the skill itself — edit that file to change the discipline applied to every task.

---

### ndx-config

**Purpose:** View, explain, and modify n-dx configuration settings with guided assistance and validation.

**When it triggers:** Invoke with `/ndx-config` (shows all settings), `/ndx-config <key>` (explains one key), or `/ndx-config <key> <value>` (validates and sets). Equivalent to the `ndx config` command but with explanations.

**What it does:** Covers LLM settings (vendor, model, API keys), Rex settings (budget thresholds, adapter), Hench settings (provider, max turns, token budget), and Web settings (dashboard port). Validates the value before applying and runs the appropriate `ndx config` command.

**Customization:** Extend the skill to add documentation for project-specific config keys or to add validation rules for your environment.

---

### ndx-reshape

**Purpose:** LLM-assisted PRD cleanup: regroup scattered epics, fix wrong levels, merge overlapping items, and normalize naming.

**When it triggers:** Invoke with `/ndx-reshape` when the PRD has grown organically and needs structural cleanup. Typically run after a long feature sprint or after multiple `ndx plan --accept` cycles.

**What it does:**
1. Calls `get_prd_status` (rex MCP) to assess the current epic/feature structure
2. Detects problems: too many epics, wrong levels, overlapping areas, orphaned items
3. Proposes a target structure (7-12 top-level epics, 3-15 features each)
4. After user approval, executes via `add_item`, `move_item`, `edit_item`, `merge_items`
5. Verifies with `reorganize` (rex MCP)

**Customization:** Adjust the target epic count or naming conventions in the skill body to match your team's PRD style guide.

---

### ndx-feedback

**Purpose:** File a GitHub issue on the n-dx repo with automatically gathered environment context and an optional anonymized project profile.

**When it triggers:** Invoke with `/ndx-feedback` or `/ndx-feedback <description>` when you encounter a bug, want to request a feature, or have a question that hints at a docs gap.

**What it does:**
1. Categorizes the feedback (bug / feature request / improvement / question)
2. Gathers environment context automatically (n-dx version, Node.js, OS, LLM provider)
3. Optionally collects an anonymized project profile (with user consent — no code or paths)
4. Drafts a GitHub issue with title, description, and labels
5. Presents the draft for review, then creates via `gh issue create`

**Customization:** Update the GitHub repo target in the skill body if you have a fork; add fields to the template for your internal triage process.

---

## Adding Your Own Skill

You can add project-specific skills alongside the bundled ones. `ndx init` only writes the skills listed in the manifest — it does not touch directories it did not create.

### File layout

```
.claude/
  skills/
    my-skill/
      SKILL.md        ← skill body with YAML frontmatter
```

### SKILL.md format

```markdown
---
name: my-skill
description: One-line description shown in /help and skill listings
argument-hint: "[optional-arg]"   # omit if no argument
---

Skill body — plain markdown instructions for the assistant.

1. First step
2. Second step
```

### Steps

1. Create the directory and file:

   ```sh
   mkdir -p .claude/skills/my-skill
   cat > .claude/skills/my-skill/SKILL.md << 'EOF'
   ---
   name: my-skill
   description: Do something project-specific
   ---

   1. Step one
   2. Step two
   EOF
   ```

2. Verify the skill appears in Claude Code by typing `/my-skill` in a new session.

3. For Codex, mirror the file to `.agents/skills/my-skill/SKILL.md`.

### Overriding a bundled skill

`ndx init` overwrites bundled skill files on each run. To permanently customize a bundled skill, use one of these approaches:

- **Project-local replacement:** Create a skill with a different name (e.g., `my-ndx-plan`) and document that it replaces the bundled one in your project's `AGENTS.md` or `CLAUDE.md`.
- **Fork the asset:** Copy the bundled skill body from `packages/core/assistant-assets/skills/<name>.md`, modify it, and write it to `.claude/skills/<name>/SKILL.md` *after* running `ndx init`. Re-apply after each `ndx init` run using a post-init script.
- **Contribute upstream:** If your customization is generally useful, open a PR to update `packages/core/assistant-assets/skills/<name>.md` and `manifest.json`.

### Adding a skill to the bundled set (contributing)

1. Add `packages/core/assistant-assets/skills/<name>.md` with the skill body.
2. Add an entry to `packages/core/assistant-assets/manifest.json` under `"skills"`:

   ```json
   "my-skill": {
     "description": "One-line description",
     "argumentHint": "[optional-arg]"
   }
   ```

3. Run `ndx init .` to generate the vendor skill files.
4. The integration tests in `tests/e2e/` verify that every manifest entry has a corresponding skill file — `listSkillFiles()` is the enforcement point.
