/**
 * What the `ndx-sidecar` broker offers a Sidecar session, and which of its
 * actions an operator may allow-list.
 *
 * Every side effect a Sidecar session can cause is one of these tools; the
 * vendor's own write tools are off (see `spawn-policy.ts`). A write tool
 * raises a permission card and returns only once the operator decides it,
 * unless the call matches a rule on the Sidecar allow-list. Only GitHub reads
 * and read-only commands can be allow-listed: work, edits, PRD writes,
 * placements, migration decisions and posts are decided card by card, every
 * time.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §4.3.
 */

/** The broker's MCP server name; the CLI exposes its tools as `mcp__ndx-sidecar__<tool>`. */
export const SIDECAR_BROKER_NAME = "ndx-sidecar";

export const BROKER_TOOL_NAMES = [
  "run_command",
  "start_work",
  "propose_prd_change",
  "propose_run_plan",
  "place_change_card",
  "propose_edit",
  "github_read",
  "draft_github_post",
  "migration_decision",
  "save_draft",
  "ledger_append",
] as const;

export type BrokerToolName = (typeof BROKER_TOOL_NAMES)[number];

/**
 * What a card records as its tool when an external tool (a connection's,
 * re-exposed under its wire name) asks: the card's input names the connection
 * and tool. Not a tool the broker offers by this name.
 */
export const EXTERNAL_CALL_TOOL = "external_call";

/** Every tool a card can record: the broker's own, or an external call. */
export type BrokerCardTool = BrokerToolName | typeof EXTERNAL_CALL_TOOL;

/** The card a tool raises; `null` for a session-local tool that raises none. */
export type SidecarCardKind =
  | "command"
  | "work"
  | "change-set"
  | "run-plan"
  | "placement"
  | "edit"
  | "network-read"
  | "draft-post"
  | "draft-file"
  | "migration-decision"
  | "external-call";

/**
 * How a tool may be allow-listed:
 * - `never`: every call raises a card.
 * - `per-call`: a rule matches one exact call (a command's argv).
 * - `per-project`: never on the allow-list; one project setting allows every
 *   call (GitHub reads: `web.sidecarGithubReads`), and with it off every call
 *   raises a card.
 */
export type AllowListability = "never" | "per-call" | "per-project";

/** The project setting that allows every `github_read`, the one `per-project` tool. */
export const GITHUB_READS_SETTING = "web.sidecarGithubReads";

export interface BrokerToolPolicy {
  card: SidecarCardKind | null;
  allowList: AllowListability;
}

export const BROKER_TOOL_POLICY: Readonly<Record<BrokerCardTool, BrokerToolPolicy>> = {
  run_command: { card: "command", allowList: "per-call" },
  start_work: { card: "work", allowList: "never" },
  propose_prd_change: { card: "change-set", allowList: "never" },
  // A plan is advice that leads to work, so it is decided card by card like work itself.
  propose_run_plan: { card: "run-plan", allowList: "never" },
  place_change_card: { card: "placement", allowList: "never" },
  propose_edit: { card: "edit", allowList: "never" },
  github_read: { card: "network-read", allowList: "per-project" },
  draft_github_post: { card: "draft-post", allowList: "never" },
  migration_decision: { card: "migration-decision", allowList: "never" },
  // A file the operator reads and may re-path on its card; nothing is written before Approve.
  save_draft: { card: "draft-file", allowList: "never" },
  ledger_append: { card: null, allowList: "never" },
  // Another server's write: the broker cannot know what it does, so it is decided card by card.
  [EXTERNAL_CALL_TOOL]: { card: "external-call", allowList: "never" },
};

/** Where a session runs: a worktree's own, or the machine's hub session. */
export type BrokerScope = "worktree" | "hub";

/**
 * The tools each scope is offered. The hub session drafts and never acts, so
 * it gets no work, edit, PRD write, placement or migration tool, nor the run
 * plan (its start is work) or a worktree's `github_read`; what it can ask for
 * is a fixed read-only command, a draft post, a draft file and its ledger.
 */
export const BROKER_SCOPE_TOOLS: Readonly<Record<BrokerScope, readonly BrokerToolName[]>> = {
  worktree: BROKER_TOOL_NAMES.filter((tool) => tool !== "save_draft"),
  hub: ["run_command", "draft_github_post", "save_draft", "ledger_append"],
};

/**
 * The only commands the hub session may ask for, each run with cwd at one
 * project's repository root: ndx status, the worktree list and the branch's
 * status. Anything else is refused without a card.
 */
export const HUB_COMMAND_ARGV: readonly (readonly string[])[] = [
  ["ndx", "status"],
  ["git", "worktree", "list"],
  ["git", "worktree", "list", "--porcelain"],
  ["git", "status", "--short", "--branch"],
];

/** Why `argv` is not one of {@link HUB_COMMAND_ARGV}; null when it is. */
export function hubCommandRefusal(argv: readonly string[]): string | null {
  if (HUB_COMMAND_ARGV.some((allowed) => allowed.length === argv.length && allowed.every((token, i) => token === argv[i]))) return null;
  const offered = HUB_COMMAND_ARGV.map((allowed) => "`" + allowed.join(" ") + "`").join(", ");
  return `the hub session runs only these read-only commands: ${offered}`;
}

/** One Sidecar allow-list rule. */
export interface AllowListRule {
  tool: BrokerCardTool;
  /** Which calls the rule covers; see {@link allowListKey}. */
  key: string;
}

/**
 * The commands an operator may allow-list: an argv must begin with one of
 * these prefixes, token for token. Each only reads. Anything else — work, a
 * PRD write, `ndx hench`, `git clean`, a shell wrapper — asks every time,
 * since a deny list misses the next command that writes.
 */
export const READ_ONLY_COMMAND_PREFIXES: readonly (readonly string[])[] = [
  ["ndx", "status"],
  ["ndx", "usage"],
  ["git", "status"],
  ["git", "log"],
  ["git", "diff"],
  ["git", "show"],
];

/** Git's `--output=<file>` writes a file, so a read-only git command carrying it is not. */
function writesThroughOption(argv: readonly string[]): boolean {
  return argv.some((token) => token === "--output" || token.startsWith("--output="));
}

function commandAllowListable(argv: readonly string[]): boolean {
  return READ_ONLY_COMMAND_PREFIXES.some((prefix) => prefix.every((token, i) => argv[i] === token))
    && !writesThroughOption(argv);
}

/**
 * The allow-list key for a call, or `null` when the call can never be
 * allow-listed. A `per-call` key is the exact argv of a read-only command
 * ({@link READ_ONLY_COMMAND_PREFIXES}), JSON-encoded so a token with a space
 * cannot alias two commands. A hub call names a project, and its key is
 * `{ project, argv }`, so allowing `ndx status` in one project allows it
 * nowhere else; a command outside {@link HUB_COMMAND_ARGV} has none. A
 * `per-project` tool has none: its project setting is its allowance.
 */
export function allowListKey(tool: BrokerCardTool, input: Readonly<Record<string, unknown>>): string | null {
  switch (BROKER_TOOL_POLICY[tool].allowList) {
    case "never":
    case "per-project":
      return null;
    case "per-call": {
      const argv = input.argv;
      if (!Array.isArray(argv) || argv.length === 0 || !argv.every((t) => typeof t === "string")) return null;
      const { project } = input;
      if (project === undefined) return commandAllowListable(argv) ? JSON.stringify(argv) : null;
      if (typeof project !== "string" || project === "" || hubCommandRefusal(argv) !== null) return null;
      return JSON.stringify({ project, argv });
    }
  }
}

/** Whether `name` is a broker tool. */
export function isBrokerTool(name: string): name is BrokerToolName {
  return (BROKER_TOOL_NAMES as readonly string[]).includes(name);
}
