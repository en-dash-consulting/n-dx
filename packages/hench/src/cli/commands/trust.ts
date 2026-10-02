/**
 * `hench trust` — review and accept what a checkout ships as execution config.
 *
 * `.hench/config.json`, `.rex/config.json` and `.mcp.json` are usually
 * tracked, so a clone or a pull request can widen what hench may run. Until
 * the user accepts a repository's configuration, hench runs under the default
 * guard and lowers `bypassPermissions`; this command shows what differs and
 * records the acceptance in the per-user ndx home, outside the repository.
 *
 *   hench trust [status] [dir]   show the evaluation (default)
 *   hench trust accept [dir]     record the current configuration as trusted
 *   hench trust revoke [dir]     forget the decision
 *
 * `--format=json` prints the full evaluation for `ndx init` and the dashboard.
 *
 * @module hench/cli/commands/trust
 */

import {
  clearRepoTrust,
  evaluateRepoTrust,
  formatRepoTrustReport,
  recordRepoTrust,
  colorWarn,
  colorSuccess,
} from "../../prd/llm-gateway.js";
import { CLIError } from "../errors.js";
import { info, result } from "../output.js";

const SUBCOMMANDS = new Set(["status", "accept", "revoke"]);

export async function cmdTrust(
  dir: string,
  positional: string[],
  flags: Record<string, string>,
): Promise<void> {
  const sub = positional[0] && SUBCOMMANDS.has(positional[0]) ? positional[0] : "status";
  if (positional[0] && !SUBCOMMANDS.has(positional[0]) && positional.length > 1) {
    throw new CLIError(`Unknown trust subcommand: ${positional[0]}`, "Usage: hench trust [status|accept|revoke] [dir]");
  }

  if (sub === "accept") {
    const before = evaluateRepoTrust(dir);
    const record = recordRepoTrust(dir);
    const after = evaluateRepoTrust(dir);
    if (flags.format === "json") {
      result(JSON.stringify({ accepted: true, record, evaluation: after }, null, 2));
      return;
    }
    if (before.state === "baseline") {
      info("Nothing to trust: this repository's execution config matches the defaults. Recorded anyway.");
    } else {
      info(colorSuccess(`Trusted this repository's execution config (${record.digest.slice(0, 12)}).`));
    }
    info(`Record: ${after.trustFile}`);
    return;
  }

  if (sub === "revoke") {
    const existed = clearRepoTrust(dir);
    if (flags.format === "json") {
      result(JSON.stringify({ revoked: existed }, null, 2));
      return;
    }
    info(existed ? "Trust revoked. The next run uses the default guard until accepted again." : "No trust record for this repository.");
    return;
  }

  const ev = evaluateRepoTrust(dir);
  if (flags.format === "json") {
    result(JSON.stringify(ev, null, 2));
    return;
  }
  const lines = formatRepoTrustReport(ev, { inventory: true, acceptCommand: "ndx trust accept ." });
  for (const line of lines) info(ev.restricted ? colorWarn(line) : line);
}
