import {
  findNextTask,
  findActionableTasks,
  collectCompletedIds,
  findItem,
  walkTree,
  collectRequirements,
  isWorkItem,
  buildChangeBrief,
  resolveWorkById,
} from "../../prd/rex-gateway.js";
import type { PRDStore, PRDItem, TreeEntry, V2Tree } from "../../prd/rex-gateway.js";
import {
  actionableV2Entries,
  inboxRefusal,
  loadV2Tree,
  namedChangeEntry,
  nextV2Entry,
  readTreeAsReset,
  resolveV2Entry,
  V2_HAS_NO_EPICS,
} from "./work-selection.js";
import { resolveProjectCliName, DEFAULT_CLI_NAME } from "./cli-identity.js";
import type {
  TaskBrief,
  TaskBriefChangeSection,
  TaskBriefTask,
  TaskBriefParent,
  TaskBriefSibling,
  TaskBriefProject,
  TaskBriefLogEntry,
  TaskBriefRequirement,
} from "../../schema/index.js";
import { CLIError } from "../../prd/llm-gateway.js";
import type { PromptSection } from "../../prd/llm-gateway.js";
import { TaskClaimedElsewhereError } from "../../process/task-claims.js";
import type { TaskClaims } from "../../process/task-claims.js";
import {
  capList,
  dedupeRequirements,
  trimDocument,
  MAX_BRIEF_SIBLINGS,
  MAX_BRIEF_REQUIREMENTS,
  MAX_WORKFLOW_CHARS,
} from "./context-caps.js";

export interface AssembleBriefOptions {
  /** Task IDs to skip during autoselection (e.g. stuck tasks). */
  excludeTaskIds?: Set<string>;
  /** Restrict task selection to this epic (ID). */
  epicId?: string;
  /** Only select tasks with at least one of these tags. */
  tags?: string[];
  /**
   * Only select tasks whose `assignee` field matches this identity string
   * (`ndx work --mine`).
   */
  assignee?: string;
  /**
   * Project root directory — used to resolve the project's CLI command name
   * (`cli.name` in `.n-dx.json`) for prompt/brief injection. Defaults to
   * "n-dx" when omitted.
   */
  projectDir?: string;
  /**
   * Cross-worktree claims for this run. When set, autoselection passes over
   * tasks another worktree holds, an explicit task held elsewhere is refused,
   * and the selected task is claimed here — before anything else happens.
   */
  claims?: TaskClaims;
  /**
   * Items a dry run's `--reset-deferred` would have returned to pending. The
   * dry run writes nothing, so the brief reads them as pending in memory —
   * for both explicit and auto selection — to show the run a real one starts.
   */
  wouldResetIds?: ReadonlySet<string>;
}

/** The items with every id in `ids` read as pending; the input is not changed. */
function readAsReset(items: PRDItem[], ids: ReadonlySet<string>): PRDItem[] {
  return items.map((item) => ({
    ...item,
    ...(ids.has(item.id) ? { status: "pending" as const } : {}),
    ...(item.children ? { children: readAsReset(item.children, ids) } : {}),
  }));
}

/** Autoselect attempts before giving up on a claim race. */
const MAX_CLAIM_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Epic task collection
// ---------------------------------------------------------------------------

/**
 * Collect all task/subtask IDs that belong to a specific epic.
 * Includes all descendants of the epic at task or subtask level.
 */
export function collectEpicTaskIds(items: PRDItem[], epicId: string): Set<string> {
  const ids = new Set<string>();

  for (const { item, parents } of walkTree(items)) {
    // Check if this item is inside the target epic
    const isInEpic =
      item.id === epicId ||
      parents.some((p) => p.id === epicId);

    if (isInEpic && isWorkItem(item.level)) {
      ids.add(item.id);
    }
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Task status validation
// ---------------------------------------------------------------------------

/** Shared predicate: check if a task is completed. */
export function isCompletedTask(item: PRDItem): boolean {
  return item.status === "completed";
}

/** Statuses that cannot be worked on. */
const NON_ACTIONABLE_STATUSES = new Set(["completed", "deferred", "blocked"]);

/**
 * Thrown when an explicitly-selected task cannot be worked on.
 *
 * Extends the foundation {@link CLIError} (which extends ClaudeClientError),
 * bringing it into the unified error hierarchy. The `suggestion` field from
 * CLIError is used directly, and additional task-specific metadata (`taskId`,
 * `status`) is available for programmatic handling.
 */
export class TaskNotActionableError extends CLIError {
  readonly taskId: string;
  readonly status: string;

  constructor(taskId: string, status: string, suggestion: string, title?: string) {
    const label = title ? `"${title}" (${taskId})` : taskId;
    super(`Task ${label} is ${status} and cannot be worked on.`, suggestion);
    this.name = "TaskNotActionableError";
    this.taskId = taskId;
    this.status = status;
  }
}

function buildSuggestion(status: string, taskId: string, cliName = DEFAULT_CLI_NAME): string {
  if (status === "completed") {
    return (
      `This task is already complete. Run '${cliName} status' to see remaining work,\n` +
      `or pick a different task with '${cliName} work --task=<ID>'.`
    );
  }
  if (status === "blocked") {
    return (
      `This task is blocked and cannot proceed until its dependencies are resolved.\n` +
      `To unblock it, run:\n` +
      `  rex update ${taskId} --status=pending\n` +
      `Then run '${cliName} work' again.`
    );
  }
  // deferred
  return (
    `This task has been deferred. To reactivate it, run:\n` +
    `  rex update ${taskId} --status=pending\n` +
    `Then run '${cliName} work' again.`
  );
}

/**
 * Why an explicitly selected task cannot be worked on, or undefined when it
 * can. `in_progress` is workable — the run resumes it. Shared with
 * `ndx work --resolve`, which reports the refusal instead of throwing it.
 */
export function explicitTaskRefusal(
  item: PRDItem,
  cliName = DEFAULT_CLI_NAME,
): TaskNotActionableError | undefined {
  if (!NON_ACTIONABLE_STATUSES.has(item.status)) return undefined;
  return new TaskNotActionableError(
    item.id,
    item.status,
    buildSuggestion(item.status, item.id, cliName),
    item.title,
  );
}

function itemToTaskBrief(item: PRDItem): TaskBriefTask {
  return {
    id: item.id,
    title: item.title,
    level: item.level,
    status: item.status,
    description: item.description,
    acceptanceCriteria: item.acceptanceCriteria,
    priority: item.priority,
    tags: item.tags,
    blockedBy: item.blockedBy,
    failureReason: item.failureReason,
  };
}

function itemToParent(item: PRDItem): TaskBriefParent {
  return {
    id: item.id,
    title: item.title,
    level: item.level,
    description: item.description,
  };
}

function getSiblings(entry: TreeEntry, doc: { items: PRDItem[] }): TaskBriefSibling[] {
  // Get the parent's children (or root items if no parent)
  const parent = entry.parents[entry.parents.length - 1];
  const siblingList = parent?.children ?? doc.items;

  return siblingList
    .filter((s: PRDItem) => s.id !== entry.item.id)
    .map((s: PRDItem) => ({
      id: s.id,
      title: s.title,
      status: s.status,
    }));
}

/** What {@link selectTaskEntry} needs to pick (and claim) one task. */
export interface SelectTaskOptions {
  /** An explicit `--task` id. When absent the selector autoselects. */
  taskId?: string;
  /** Task IDs to skip during autoselection (e.g. stuck tasks). */
  excludeTaskIds?: Set<string>;
  /** Restrict selection to this epic (ID). */
  epicId?: string;
  /** Only select tasks carrying at least one of these tags. */
  tags?: string[];
  /** Only select tasks assigned to this identity (`ndx work --mine`). */
  assignee?: string;
  /** Cross-worktree claims. The selected task is claimed before it is returned. */
  claims?: TaskClaims;
  /** The project's CLI command name, for the refusal's advice. */
  cliName?: string;
  /**
   * Items a dry run's `--reset-deferred` would have returned to pending; they
   * are read as pending here so selection picks what a real run would.
   * {@link assembleTaskBrief} applies this to the whole document before it
   * calls, so it does not pass it twice — `runOne` does, selecting off the
   * untransformed tree.
   */
  wouldResetIds?: ReadonlySet<string>;
  /**
   * The v2 tree `rawItems` were projected from ({@link loadV2Tree}). When set,
   * selection is rex's v2 selection (`findNextWorkTask`, `resolveWorkById`) and
   * `rawItems` only supply the entry; there is no epic level to scope to.
   */
  tree?: V2Tree;
}

/**
 * The one task a run executes, claimed for this worktree.
 *
 * Extracted from {@link assembleTaskBrief} so `runOne` can learn which task it
 * is about to run *before* it chooses a loop and resolves that task's saved
 * settings. Both call this; a second selector in run.ts would be free to pick
 * a different task from the one the brief then builds, and the settings would
 * belong to neither.
 *
 * An explicit id is refused rather than stolen when another worktree holds it.
 * Autoselection claims as it goes: another worktree may claim the same task
 * between our read and our claim, so the loser excludes that id and selects
 * again, bounded so a store that refuses everything ends in an error rather
 * than a spin.
 *
 * @throws {Error} "No actionable tasks found in PRD" / "... in epic" when
 *   selection comes up empty — the sentinel `--loop` reads as "done".
 */
export async function selectTaskEntry(
  rawItems: PRDItem[],
  options: SelectTaskOptions = {},
): Promise<TreeEntry> {
  const { taskId, excludeTaskIds: excludeIds, epicId, tags, assignee, claims } = options;
  const cliName = options.cliName ?? DEFAULT_CLI_NAME;
  const items = options.wouldResetIds?.size ? readAsReset(rawItems, options.wouldResetIds) : rawItems;
  const tree = options.tree && options.wouldResetIds?.size
    ? readTreeAsReset(options.tree, options.wouldResetIds)
    : options.tree;
  if (tree && epicId) throw new Error(`Cannot scope selection to an epic: ${V2_HAS_NO_EPICS}.`);

  if (taskId) {
    // On v2 the ref may be a display id or alias; the entry carries the real id.
    // A change with open tasks runs its next one no other worktree holds, so
    // the claim below is on that task, never on the change.
    const foreign = tree && claims ? await claims.foreignClaims() : undefined;
    const entry = tree ? resolveV2Entry(tree, items, taskId, foreign, cliName) : findItem(items, taskId);
    if (!entry) throw new Error(`Task not found: ${taskId}`);
    const inbox = tree ? inboxRefusal(tree, taskId, cliName) : undefined;
    if (inbox) throw inbox;
    const notActionable = explicitTaskRefusal(entry.item, cliName);
    if (notActionable) throw notActionable;
    // A ref naming a change runs one of its tasks; the change's status still gates it.
    const named = tree ? namedChangeEntry(tree, items, taskId, entry) : null;
    const changeNotActionable = named ? explicitTaskRefusal(named.item, cliName) : undefined;
    if (changeNotActionable) throw changeNotActionable;
    // An explicit task another worktree is working on is refused, not stolen.
    // Claiming is the check: the store answers atomically under its lock.
    if (claims) {
      // On v2 a claim on an enclosing change covers the work inside it (rex
      // refuses the same in claim_task), so the task's own id is not enough.
      if (tree) {
        const held = await claims.heldByEnclosingChange(tree, entry.item.id);
        if (held) throw new TaskClaimedElsewhereError(held.changeId, held.claim, findItem(items, held.changeId)?.item.title);
      }
      const refusedBy = await claims.claim(entry.item.id);
      if (refusedBy) throw new TaskClaimedElsewhereError(entry.item.id, refusedBy, entry.item.title);
    }
    return entry;
  }

  const completedIds = collectCompletedIds(items);
  // When excluding stuck tasks, treat them as completed so findNextTask skips them.
  const skipIds = excludeIds ? new Set([...completedIds, ...excludeIds]) : completedIds;
  // Tasks other worktrees hold are passed over — not folded into skipIds,
  // which would make their parents look finished.
  const claimedElsewhere = new Set<string>(claims ? (await claims.foreignClaims()).keys() : []);

  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    // rex's collectActionable reads `skipIds` only as "done" for dependency
    // checks, so an excluded (stuck) task is still a candidate unless it is
    // also named here — the v2 branch below already passes both.
    const passOver = new Set<string>([...claimedElsewhere, ...(excludeIds ?? [])]);
    const selectOptions = {
      ...(tags?.length ? { tags } : {}),
      ...(assignee ? { assignee } : {}),
      ...(passOver.size > 0 ? { excludeIds: passOver } : {}),
    };
    let candidate: TreeEntry | null;
    if (tree) {
      candidate = nextV2Entry(tree, {
        excludeIds: new Set([...(excludeIds ?? []), ...claimedElsewhere]),
        ...(tags?.length ? { tags } : {}),
        ...(assignee ? { assignee } : {}),
      });
      if (!candidate) throw new Error("No actionable tasks found in PRD");
    } else if (epicId) {
      // Epic filter active: get all actionable tasks and filter to the epic.
      const epicTaskIds = collectEpicTaskIds(items, epicId);
      const allActionable = findActionableTasks(items, skipIds, Infinity, selectOptions);
      const epicActionable = allActionable.filter(
        (e) => epicTaskIds.has(e.item.id) && !excludeIds?.has(e.item.id),
      );
      if (epicActionable.length === 0) throw new Error("No actionable tasks found in epic");
      // findActionableTasks already sorts by priority, so first is best.
      candidate = epicActionable[0];
    } else {
      candidate = findNextTask(items, skipIds, selectOptions);
      if (!candidate) throw new Error("No actionable tasks found in PRD");
    }

    if (!claims) return candidate;
    const refusedBy = await claims.claim(candidate.item.id);
    if (!refusedBy) return candidate;
    claimedElsewhere.add(candidate.item.id);
  }
  throw new Error(
    `Could not claim a task after ${MAX_CLAIM_ATTEMPTS} attempts — each candidate was claimed by another worktree first.`,
  );
}

/**
 * Rex's change brief for the unit `unitId` on a v2 tree, section by section.
 *
 * The project's validate and test commands are left out for the reason the v1
 * brief has no project block: the system prompt states them, and both reach
 * the model in one call.
 *
 * workflow.md is left out too: it is execution policy, and rex's budget drops
 * it whole once a change fills the brief. {@link formatChangeBrief} renders it
 * outside that budget, as v1 does.
 */
function changeBriefSections(
  tree: V2Tree,
  unitId: string,
  recentLog: readonly TaskBriefLogEntry[],
): TaskBriefChangeSection[] {
  // Selection resolved this id to a unit a moment ago, through the same tree.
  const unit = resolveWorkById(tree, unitId);
  if (!unit) throw new Error(`Cannot brief ${unitId}: it is not a unit of work on this v2 tree.`);
  const { sections } = buildChangeBrief({ tree, unit, recentLog });
  return sections.map(({ name, text }) => ({ name, text }));
}

export async function assembleTaskBrief(
  store: PRDStore,
  taskId?: string,
  options?: AssembleBriefOptions,
): Promise<{ brief: TaskBrief; taskId: string }> {
  const loaded = await store.loadDocument();
  const resetIds = options?.wouldResetIds;
  const doc = resetIds?.size ? { ...loaded, items: readAsReset(loaded.items, resetIds) } : loaded;
  const config = await store.loadConfig();
  const excludeIds = options?.excludeTaskIds;
  const tags = options?.tags?.length ? options.tags : undefined;
  const assignee = options?.assignee;
  const cliName = options?.projectDir
    ? resolveProjectCliName(options.projectDir)
    : DEFAULT_CLI_NAME;

  const loadedTree = await loadV2Tree(store);
  const tree = loadedTree && resetIds?.size ? readTreeAsReset(loadedTree, resetIds) : loadedTree;
  const entry = await selectTaskEntry(doc.items, {
    ...(tree ? { tree } : {}),
    ...(taskId ? { taskId } : {}),
    ...(excludeIds ? { excludeTaskIds: excludeIds } : {}),
    ...(options?.epicId ? { epicId: options.epicId } : {}),
    ...(tags ? { tags } : {}),
    ...(assignee ? { assignee } : {}),
    ...(options?.claims ? { claims: options.claims } : {}),
    cliName,
  });

  let workflow = "";
  try {
    workflow = await store.loadWorkflow();
  } catch {
    // No workflow file
  }

  const recentLog = await store.readLog(20);

  const project: TaskBriefProject = {
    name: config.project,
    validateCommand: config.validate,
    testCommand: config.test,
    cliName,
  };

  // Collect requirements (own + inherited from parent chain)
  const tracedReqs = collectRequirements(doc.items, entry.item.id);
  const requirements: TaskBriefRequirement[] = tracedReqs.map((tr) => ({
    id: tr.requirement.id,
    title: tr.requirement.title,
    category: tr.requirement.category,
    validationType: tr.requirement.validationType,
    acceptanceCriteria: tr.requirement.acceptanceCriteria,
    source: tr.sourceItemTitle,
  }));

  const brief: TaskBrief = {
    ...(tree ? { changeBrief: changeBriefSections(tree, entry.item.id, recentLog) } : {}),
    task: itemToTaskBrief(entry.item),
    parentChain: entry.parents.map(itemToParent),
    siblings: getSiblings(entry, doc),
    // collectRequirements walks the whole parent chain, so a constraint
    // restated at several levels arrives once per level. Collapse those
    // before they are rendered (and re-sent on every retry).
    requirements: dedupeRequirements(requirements),
    project,
    workflow,
    recentLog: recentLog.map((e) => ({
      timestamp: e.timestamp,
      event: e.event,
      detail: e.detail,
    })),
    ...(tags || assignee
      ? { sessionFilters: { ...(tags ? { tags } : {}), ...(assignee ? { assignee } : {}) } }
      : {}),
  };

  return { brief, taskId: entry.item.id };
}

export interface ActionableTask {
  id: string;
  title: string;
  level: string;
  priority: string;
  parentChain: string;
}

/**
 * The interactive menu's task list.
 *
 * `assignee` is the `--mine` filter and has to be honored here as well as in
 * {@link assembleTaskBrief}: the attended path (`ndx work --mine` in a TTY, no
 * `--task`/`--auto`/`--loop`) never reaches autoselection — it builds this menu
 * and passes the chosen id back as an explicit task, which bypasses the filter
 * by design. Without it the flag silently did nothing on the most common human
 * path, offering every actionable task regardless of who it belongs to.
 */
export async function getActionableTasks(
  store: PRDStore,
  limit = 20,
  claims?: TaskClaims,
  assignee?: string,
): Promise<ActionableTask[]> {
  const doc = await store.loadDocument();
  const completedIds = collectCompletedIds(doc.items);
  const claimedElsewhere = claims ? new Set((await claims.foreignClaims()).keys()) : undefined;
  const selectOptions = {
    ...(claimedElsewhere?.size ? { excludeIds: claimedElsewhere } : {}),
    ...(assignee ? { assignee } : {}),
  };
  const tree = await loadV2Tree(store);
  const entries = tree
    ? actionableV2Entries(tree, doc.items, selectOptions).slice(0, limit)
    : findActionableTasks(
        doc.items,
        completedIds,
        limit,
        Object.keys(selectOptions).length > 0 ? selectOptions : undefined,
      );

  return entries.map((e) => ({
    id: e.item.id,
    title: e.item.title,
    level: e.item.level,
    priority: e.item.priority ?? "medium",
    parentChain: e.parents.map((p) => p.title).join(" > "),
  }));
}

// ---------------------------------------------------------------------------
// Prompt section contribution
// ---------------------------------------------------------------------------

/**
 * Build {@link PromptSection}s from a {@link TaskBrief}.
 *
 * Contributes sections to the prompt envelope. Currently produces a single
 * "brief" section whose content is identical to {@link formatTaskBrief}.
 * Future work may split the brief into finer-grained sections (e.g.
 * separating workflow or file context).
 *
 * @see buildPromptEnvelope in prompt.ts — composes these sections with the
 *      system section into a complete PromptEnvelope.
 */
export function buildBriefSections(brief: TaskBrief): PromptSection[] {
  return [
    { name: "brief", content: formatTaskBrief(brief) },
  ];
}

// ---------------------------------------------------------------------------
// Brief text formatting (backward-compatible flat string)
// ---------------------------------------------------------------------------

/**
 * Commit trailers — the task id and run live here, not in the system prompt,
 * which is built per project. Placed right after the task so a brief truncated
 * to the vendor's context limit still carries them.
 */
function commitTrailersBlock(brief: TaskBrief): string | undefined {
  if (!brief.commitTrailers?.length) return undefined;
  return [
    "## Commit Trailers",
    "End every commit message you write for this task with these exact lines, " +
      "in one final trailer block together with your own trailers (such as " +
      "Co-Authored-By:) and no blank line between them:",
    "```",
    ...brief.commitTrailers,
    "```",
  ].join("\n");
}

/** Session filters (e.g. self-heal tag constraint, --mine assignee constraint). */
function sessionFiltersBlock(brief: TaskBrief): string | undefined {
  const { tags, assignee } = brief.sessionFilters ?? {};
  if (!tags?.length && !assignee) return undefined;
  const lines = ["## Session Filters"];
  if (tags?.length) {
    lines.push(`Active tag filter: ${tags.join(", ")} — only tasks with these tags are eligible for selection.`);
  }
  if (assignee) {
    lines.push(`Active assignee filter: ${assignee} — only tasks assigned to this identity are eligible for selection.`);
  }
  return lines.join("\n");
}

/**
 * workflow.md — trimmed at a line boundary. This file states rules, so a
 * mid-line cut would leave a truncated rule reading as a complete one.
 */
function workflowBlock(brief: TaskBrief): string | undefined {
  if (!brief.workflow) return undefined;
  return `## Workflow\n${trimDocument(brief.workflow, MAX_WORKFLOW_CHARS, "workflow.md")}`;
}

/**
 * The v2 brief: rex's change brief, with hench's own blocks inserted — the
 * commit trailers and session filters right after the task section (rex
 * never drops it), and workflow.md before the log and the trimmed note.
 * Rex bounded and budgeted every section of its own; workflow is outside that
 * budget, as on v1, because the project's execution rules must always arrive.
 */
function formatChangeBrief(brief: TaskBrief, changeBrief: readonly TaskBriefChangeSection[]): string {
  const own = [commitTrailersBlock(brief), sessionFiltersBlock(brief)].filter((b): b is string => b !== undefined);
  const blocks = changeBrief.flatMap((section) => (section.name === "task" ? [section.text, ...own] : [section.text]));
  const workflow = workflowBlock(brief);
  if (workflow) {
    const tail = changeBrief.findIndex((section) => section.name === "log" || section.name === "trimmed");
    blocks.splice(tail === -1 ? blocks.length : tail + own.length, 0, workflow);
  }
  return blocks.join("\n\n");
}

export function formatTaskBrief(brief: TaskBrief): string {
  if (brief.changeBrief?.length) return formatChangeBrief(brief, brief.changeBrief);
  const sections: string[] = [];

  // Task
  sections.push("## Current Task");
  sections.push(`**${brief.task.title}** (${brief.task.level})`);
  sections.push(`ID: ${brief.task.id}`);
  sections.push(`Status: ${brief.task.status}`);
  if (brief.task.priority) sections.push(`Priority: ${brief.task.priority}`);
  if (brief.task.blockedBy?.length) {
    sections.push(`Blocked by: ${brief.task.blockedBy.join(", ")}`);
  }
  if (brief.task.description) sections.push(`\nDescription:\n${brief.task.description}`);
  if (brief.task.acceptanceCriteria?.length) {
    sections.push("\nAcceptance Criteria:");
    for (const c of brief.task.acceptanceCriteria) {
      sections.push(`- ${c}`);
    }
  }
  if (brief.task.tags?.length) {
    sections.push(`Tags: ${brief.task.tags.join(", ")}`);
  }
  if (brief.task.failureReason) {
    // A bare heading over the prior failure text leaves the model to infer
    // what to do with it, and the most available continuation is the approach
    // it just watched fail. Name the retry, then ask for a different route
    // before any code is written — the instruction has to arrive with the
    // evidence, not be inferred from it.
    sections.push("\n## Previous attempt failed — do not repeat it");
    sections.push("A prior run of this same task failed. What went wrong:");
    sections.push(brief.task.failureReason);
    sections.push(
      "Diagnose why that happened before you change anything, and take a " +
        "different approach. If you conclude the previous approach was right " +
        "and only its execution was wrong, say so explicitly and explain what " +
        "you are doing differently this time.",
    );
  }

  const trailers = commitTrailersBlock(brief);
  if (trailers) sections.push(`\n${trailers}`);

  // Parent chain
  if (brief.parentChain.length > 0) {
    sections.push("\n## Context (Parent Chain)");
    for (const p of brief.parentChain) {
      sections.push(`- **${p.title}** (${p.level})`);
      if (p.description) sections.push(`  ${p.description}`);
    }
  }

  // Requirements
  if (brief.requirements.length > 0) {
    sections.push("\n## Requirements");
    const cappedReqs = capList(brief.requirements, MAX_BRIEF_REQUIREMENTS);
    for (const req of cappedReqs.items) {
      sections.push(`- **${req.title}** [${req.category}/${req.validationType}] (from: ${req.source})`);
      for (const ac of req.acceptanceCriteria) {
        sections.push(`  - ${ac}`);
      }
    }
    if (cappedReqs.omitted > 0) {
      sections.push(
        `- … ${cappedReqs.omitted} more inherited requirement(s) not listed ` +
          `(of ${brief.requirements.length} total)`,
      );
    }
  }

  // Siblings — capped: this list grows with the parent's fan-out, not with
  // the task, and is re-sent on every retry.
  if (brief.siblings.length > 0) {
    sections.push("\n## Sibling Tasks");
    const cappedSiblings = capList(brief.siblings, MAX_BRIEF_SIBLINGS);
    for (const s of cappedSiblings.items) {
      const marker = s.status === "completed" ? "[x]" : "[ ]";
      sections.push(`- ${marker} ${s.title} (${s.status})`);
    }
    if (cappedSiblings.omitted > 0) {
      sections.push(
        `- … ${cappedSiblings.omitted} more sibling task(s) not listed ` +
          `(of ${brief.siblings.length} total)`,
      );
    }
  }

  const filters = sessionFiltersBlock(brief);
  if (filters) sections.push(`\n${filters}`);

  // Project
  // No project block here. `buildSystemPrompt` emits the same four facts under
  // `## Project Info`, and both halves reach the model in one call, so this was
  // billed twice on every autonomous run. The system prompt keeps them: it also
  // carries the instruction to use the CLI name when referring to the project,
  // and it is the stable half of the pair while the brief changes per task.
  //
  // One caller sends the brief without that system prompt — `callVerifier` in
  // lifecycle/loop.ts pairs it with a reviewer prompt of its own. It is asking
  // whether a solution satisfies the task's acceptance criteria, which the
  // project's name and command list do not bear on.

  const workflow = workflowBlock(brief);
  if (workflow) sections.push(`\n${workflow}`);

  // Recent log
  if (brief.recentLog.length > 0) {
    sections.push("\n## Recent Activity");
    for (const entry of brief.recentLog.slice(-10)) {
      const line = entry.detail
        ? `- [${entry.timestamp}] ${entry.event}: ${entry.detail}`
        : `- [${entry.timestamp}] ${entry.event}`;
      sections.push(line);
    }
  }

  return sections.join("\n");
}
