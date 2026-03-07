/**
 * Claude Code integration — auto-configures MCP servers, skills, and permissions
 * when `ndx init` is run.
 *
 * This module is called by cli.js during init (unless --no-claude is passed).
 * It writes:
 *   1. `.claude/settings.local.json` — MCP tool permissions (merged, not overwritten)
 *   2. `.claude/skills/` — workflow skill files (overwritten on each init)
 *   3. MCP server registration via `claude mcp add` (best-effort)
 *
 * @module n-dx/claude-integration
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Permission tiers ──────────────────────────────────────────────────────────

/** Read-only MCP tools — auto-approved without user confirmation. */
const AUTO_APPROVED_TOOLS = [
  // Sourcevision read tools
  "mcp__sourcevision__get_overview",
  "mcp__sourcevision__get_zone",
  "mcp__sourcevision__get_file_info",
  "mcp__sourcevision__get_imports",
  "mcp__sourcevision__search_files",
  "mcp__sourcevision__get_findings",
  "mcp__sourcevision__get_classifications",
  "mcp__sourcevision__get_next_steps",
  "mcp__sourcevision__get_route_tree",
  // Rex read tools
  "mcp__rex__get_prd_status",
  "mcp__rex__get_next_task",
  "mcp__rex__get_item",
  "mcp__rex__get_capabilities",
  "mcp__rex__get_recommendations",
  "mcp__rex__health",
  "mcp__rex__facets",
];

// Write tools are intentionally omitted — they require user approval by default.
// This includes: add_item, update_task_status, move_item, merge_items,
// set_file_archetype, reorganize, append_log, verify_criteria, sync_with_remote

// ── Skills ────────────────────────────────────────────────────────────────────

/**
 * Skills are written as `.claude/skills/<name>/SKILL.md`.
 * Keys are directory names; values are SKILL.md content.
 */
const SKILLS = {
  plan: `---
name: plan
description: Analyze the codebase and propose PRD updates
---

Analyze the codebase and propose PRD updates.

1. Call \`get_overview\` (sourcevision MCP) to understand current project state
2. Call \`get_findings\` (sourcevision MCP) to identify anti-patterns and suggestions
3. Call \`get_prd_status\` (rex MCP) to see existing PRD items and avoid duplicates
4. Call \`get_next_steps\` (sourcevision MCP) for prioritized recommendations
5. Based on findings, existing gaps, and any user-described goals, propose new epics/features/tasks
6. Present proposals to the user for review
7. For each approved proposal, use \`add_item\` (rex MCP) to create it with appropriate descriptions, acceptance criteria, and parent placement
8. Show the updated PRD tree via \`get_prd_status\`
`,

  status: `---
name: status
description: Show comprehensive project status combining PRD progress and codebase health
---

Show comprehensive project status combining PRD progress and codebase health.

1. Call \`get_prd_status\` (rex MCP) for PRD tree with completion stats
2. Call \`get_overview\` (sourcevision MCP) for codebase metrics (files, zones, languages)
3. Call \`get_findings\` (sourcevision MCP) with severity "warning" or "critical" for active issues
4. Call \`health\` (rex MCP) for structure health score
5. Call \`get_next_task\` (rex MCP) to show recommended next action
6. Present a unified report: progress, health, critical findings, and next steps
`,

  capture: `---
name: capture
description: Capture a requirement, feature idea, or task from conversation context
argument-hint: "[description]"
---

Capture a requirement, feature idea, or task from conversation context.

1. If a description is provided, use it. Otherwise, review recent conversation for feature requests, requirements, or product decisions
2. Call \`get_prd_status\` (rex MCP) to understand current PRD structure
3. Determine the appropriate level:
   - Epic: large initiative spanning multiple features
   - Feature: a capability or user-facing behavior
   - Task: a concrete, implementable work item
4. Find the appropriate parent by matching to existing epics/features
5. Draft the item: title, description, acceptance criteria
6. Present to the user for confirmation before creating
7. Use \`add_item\` (rex MCP) to create, then confirm placement in hierarchy
`,

  zone: `---
name: zone
description: Deep-dive into an architectural zone's structure and health
argument-hint: "[zone-id]"
---

Deep-dive into an architectural zone's structure and health.

1. If no zone-id given, call \`get_overview\` (sourcevision MCP) and list available zones with brief descriptions. Ask which to explore.
2. Call \`get_zone\` (sourcevision MCP) with the zone ID for full details
3. Read \`.sourcevision/zones/{zone-id}/context.md\` for detailed context
4. Call \`get_findings\` (sourcevision MCP) and filter to findings relevant to this zone
5. Call \`get_imports\` (sourcevision MCP) for cross-zone dependency edges
6. Present: zone purpose, key files, cohesion/coupling metrics, findings, and cross-zone dependencies
`,

  work: `---
name: work
description: Pick up a task from the PRD and begin working on it
argument-hint: "[task-id]"
---

Pick up a task from the PRD and begin working on it.

1. If task-id provided, call \`get_item\` (rex MCP). Otherwise call \`get_next_task\` (rex MCP)
2. Read task details: title, description, acceptance criteria, parent chain
3. For files mentioned in the task, use \`get_file_info\` and \`get_imports\` (sourcevision MCP) to understand current state
4. Use \`get_zone\` (sourcevision MCP) for the relevant architectural zone
5. Present a work plan: what needs to change, which files, what tests
6. After user approves the plan, call \`update_task_status\` (rex MCP) to mark as \`in_progress\`
7. Implement the changes
8. When done, use \`update_task_status\` (rex MCP) to mark as \`completed\`
`,

  configure: `---
name: configure
description: View or change n-dx configuration with guided assistance
argument-hint: "[key] [value]"
---

View or change n-dx configuration with guided assistance.

Available configuration areas:
- LLM settings: vendor (claude/codex), model, API keys, CLI paths
- Rex settings: budget thresholds, level-of-effort params, adapter
- Hench settings: provider, model, max turns, token budget, guard policies
- Web settings: dashboard port

If no arguments: show current configuration summary
If key only: show current value and explain what it controls
If key and value: validate and set the value

Run the appropriate \`ndx config\` command to apply changes.
`,
};

// ── Settings merge ────────────────────────────────────────────────────────────

/**
 * Merge n-dx auto-approved tools into existing settings.local.json.
 * Preserves all existing user permissions — only adds missing entries.
 */
function mergeSettings(dir) {
  const claudeDir = join(dir, ".claude");
  const settingsPath = join(claudeDir, "settings.local.json");

  let existing = { permissions: { allow: [] } };
  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      // Corrupted — start fresh but preserve the file structure
    }
  }

  if (!existing.permissions) existing.permissions = {};
  if (!Array.isArray(existing.permissions.allow)) existing.permissions.allow = [];

  const currentSet = new Set(existing.permissions.allow);
  let added = 0;

  for (const tool of AUTO_APPROVED_TOOLS) {
    if (!currentSet.has(tool)) {
      existing.permissions.allow.push(tool);
      added++;
    }
  }

  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + "\n");

  return { added, total: AUTO_APPROVED_TOOLS.length };
}

// ── Skill writing ─────────────────────────────────────────────────────────────

/**
 * Write all skill files to `.claude/skills/<name>/SKILL.md`.
 * Overwrites existing skill files (they're n-dx-managed).
 * Also cleans up old flat-file format (`.claude/skills/<name>.md`).
 */
function writeSkills(dir) {
  const skillsDir = join(dir, ".claude", "skills");
  mkdirSync(skillsDir, { recursive: true });

  let written = 0;
  for (const [name, content] of Object.entries(SKILLS)) {
    // Clean up old flat-file format if it exists
    const oldPath = join(skillsDir, `${name}.md`);
    if (existsSync(oldPath)) {
      try { unlinkSync(oldPath); } catch { /* ignore */ }
    }

    const skillDir = join(skillsDir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), content);
    written++;
  }

  return { written };
}

// ── MCP registration ──────────────────────────────────────────────────────────

/**
 * Register MCP servers with Claude Code CLI (best-effort).
 * Prefers HTTP transport if the web server is running, falls back to stdio.
 */
function registerMcpServers(dir) {
  const hasClaude = hasClaudeCli();
  if (!hasClaude) {
    return { registered: false, reason: "claude CLI not found" };
  }

  const results = [];

  // Always use stdio — it doesn't require a running server
  const rexBin = resolve(__dir, "packages/rex/dist/cli/index.js");
  const svBin = resolve(__dir, "packages/sourcevision/dist/cli/index.js");
  const absDir = resolve(dir);

  try {
    execSync(
      `claude mcp add rex -- node "${rexBin}" mcp "${absDir}"`,
      { stdio: "ignore", timeout: 10_000 },
    );
    results.push({ name: "rex", transport: "stdio", ok: true });
  } catch {
    results.push({ name: "rex", transport: "stdio", ok: false });
  }

  try {
    execSync(
      `claude mcp add sourcevision -- node "${svBin}" mcp "${absDir}"`,
      { stdio: "ignore", timeout: 10_000 },
    );
    results.push({ name: "sourcevision", transport: "stdio", ok: true });
  } catch {
    results.push({ name: "sourcevision", transport: "stdio", ok: false });
  }

  return { registered: true, servers: results };
}

function hasClaudeCli() {
  try {
    execSync("claude --version", { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the full Claude Code integration setup.
 *
 * @param {string} dir  Project root directory
 * @returns {{ settings: object, skills: object, mcp: object }}
 */
export function setupClaudeIntegration(dir) {
  const absDir = resolve(dir);

  const settings = mergeSettings(absDir);
  const skills = writeSkills(absDir);
  const mcp = registerMcpServers(absDir);

  return { settings, skills, mcp };
}

/**
 * Print a summary of what was configured.
 */
export function printClaudeSetupSummary(result) {
  console.log("");
  console.log("Claude Code integration:");

  // Settings
  if (result.settings.added > 0) {
    console.log(`  Settings: added ${result.settings.added} auto-approved tool permissions`);
  } else {
    console.log(`  Settings: all ${result.settings.total} tool permissions already present`);
  }

  // Skills
  console.log(`  Skills: wrote ${result.skills.written} workflow skills (/plan, /status, /capture, /zone, /work, /configure)`);

  // MCP
  if (!result.mcp.registered) {
    console.log(`  MCP servers: skipped (${result.mcp.reason})`);
    console.log("  To register manually, see: ndx --help init");
  } else {
    const ok = result.mcp.servers.filter((s) => s.ok);
    const failed = result.mcp.servers.filter((s) => !s.ok);
    if (ok.length > 0) {
      console.log(`  MCP servers: registered ${ok.map((s) => s.name).join(", ")} (${ok[0].transport})`);
    }
    if (failed.length > 0) {
      console.log(`  MCP servers: failed to register ${failed.map((s) => s.name).join(", ")}`);
    }
  }
}
