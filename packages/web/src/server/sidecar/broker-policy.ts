/**
 * What the `ndx-sidecar` broker offers a Sidecar session, and which of its
 * actions an operator may allow-list.
 *
 * Every side effect a Sidecar session can cause is one of these tools; the
 * vendor's own write tools are off (see `spawn-policy.ts`). A write tool
 * raises a permission card and returns only once the operator decides it,
 * unless the call matches a rule on the Sidecar allow-list. Most actions can
 * never be allow-listed: work, edits, PRD writes, placements, migration
 * decisions and posts are decided card by card, every time.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §4.3.
 */

/** The broker's MCP server name; the CLI exposes its tools as `mcp__ndx-sidecar__<tool>`. */
export const SIDECAR_BROKER_NAME = "ndx-sidecar";

export const BROKER_TOOL_NAMES = [
  "run_command",
  "start_work",
  "propose_prd_change",
  "place_change_card",
  "propose_edit",
  "github_read",
  "draft_github_post",
  "migration_decision",
  "ledger_append",
] as const;

export type BrokerToolName = (typeof BROKER_TOOL_NAMES)[number];

/** The card a tool raises; `null` for a session-local tool that raises none. */
export type SidecarCardKind =
  | "command"
  | "work"
  | "change-set"
  | "placement"
  | "edit"
  | "network-read"
  | "draft-post"
  | "migration-decision";

/**
 * How a tool may be allow-listed:
 * - `never`: every call raises a card.
 * - `per-call`: a rule matches one exact call (a command's argv).
 * - `per-tool`: one rule covers every call of the tool (GitHub reads).
 */
export type AllowListability = "never" | "per-call" | "per-tool";

export interface BrokerToolPolicy {
  card: SidecarCardKind | null;
  allowList: AllowListability;
}

export const BROKER_TOOL_POLICY: Readonly<Record<BrokerToolName, BrokerToolPolicy>> = {
  run_command: { card: "command", allowList: "per-call" },
  start_work: { card: "work", allowList: "never" },
  propose_prd_change: { card: "change-set", allowList: "never" },
  place_change_card: { card: "placement", allowList: "never" },
  propose_edit: { card: "edit", allowList: "never" },
  github_read: { card: "network-read", allowList: "per-tool" },
  draft_github_post: { card: "draft-post", allowList: "never" },
  migration_decision: { card: "migration-decision", allowList: "never" },
  ledger_append: { card: null, allowList: "never" },
};

/** One Sidecar allow-list rule. */
export interface AllowListRule {
  tool: BrokerToolName;
  /** Which calls the rule covers; see {@link allowListKey}. */
  key: string;
}

/**
 * A command that starts work, resets state or pushes is never allow-listed,
 * however the operator answers its card. The rule is on the words inside
 * every argv token, not the tokens alone, so a command wrapped in a shell
 * string (`sh -c "ndx work ."`) is caught as well as `ndx work`, `git reset`
 * and `git push`. It errs toward asking: a token that merely contains one of
 * the words (`work.md`) is never allow-listed either.
 */
function commandNeverAllowListed(argv: readonly string[]): boolean {
  return argv
    .flatMap((token) => token.toLowerCase().split(/[^a-z0-9-]+/))
    .some((word) => word === "work" || word === "reset" || word === "push" || word.startsWith("--push"));
}

/**
 * The allow-list key for a call, or `null` when the call can never be
 * allow-listed. A `per-call` key is the exact argv, JSON-encoded so a token
 * with a space cannot alias two commands.
 */
export function allowListKey(tool: BrokerToolName, input: Readonly<Record<string, unknown>>): string | null {
  switch (BROKER_TOOL_POLICY[tool].allowList) {
    case "never":
      return null;
    case "per-tool":
      return "*";
    case "per-call": {
      const argv = input.argv;
      if (!Array.isArray(argv) || argv.length === 0 || !argv.every((t) => typeof t === "string")) return null;
      return commandNeverAllowListed(argv) ? null : JSON.stringify(argv);
    }
  }
}

/** Whether `name` is a broker tool. */
export function isBrokerTool(name: string): name is BrokerToolName {
  return (BROKER_TOOL_NAMES as readonly string[]).includes(name);
}
