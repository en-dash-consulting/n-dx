/**
 * The git subcommands a policy grants.
 *
 * A guard that names no `allowedGitSubcommands` — the key absent, or an
 * explicit empty list — gets the language baseline, not every subcommand
 * there is. One definition, read by the Claude CLI adapter when it spells
 * `--allowed-tools` and by the policy fingerprint when it hashes a chain's
 * permissions, so the two cannot disagree about what an empty list grants.
 */

import { guardBaselineForLanguage } from "../../prd/llm-gateway.js";

export function effectiveGitSubcommands(allowedGitSubcommands?: ReadonlyArray<string>): string[] {
  return allowedGitSubcommands && allowedGitSubcommands.length > 0
    ? [...allowedGitSubcommands]
    : guardBaselineForLanguage().allowedGitSubcommands;
}
