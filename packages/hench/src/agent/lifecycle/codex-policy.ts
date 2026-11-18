/** Capability limits shared by execution and dashboard run resolution. */
export function codexGuardLimitations(vendor: string, provider: string): string | undefined {
  if (vendor !== "codex" || provider !== "cli") return undefined;
  return "Codex CLI does not enforce hench.guard.allowedCommands, " +
    "hench.guard.allowedGitSubcommands, hench.guard.blockedPaths or allowedFileTools. " +
    "Its filesystem sandbox is not a command allowlist or a read-path boundary. " +
    "These controls remain unsupported on fresh, resumed and forked sessions. " +
    "Use n-dx work --provider=api with a supported OpenAI model when Hench tool guards are required; " +
    "no provider fallback is applied automatically.";
}
