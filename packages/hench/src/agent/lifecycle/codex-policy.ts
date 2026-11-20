/** Capability limits shared by execution and dashboard run resolution. */
export function codexGuardLimitations(
  vendor: string, provider: string, reviewMode?: string, reviewVendor?: string,
): string | undefined {
  const pair = reviewMode === "pair" && reviewVendor === "codex";
  if (provider !== "cli" || (vendor !== "codex" && !pair)) return undefined;
  return (pair ? "Codex pair reviewer CLI" : "Codex CLI") + " does not enforce hench.guard.allowedCommands, " +
    "hench.guard.allowedGitSubcommands, hench.guard.blockedPaths or allowedFileTools. " +
    "Its filesystem sandbox is not a command allowlist or a read-path boundary. " +
    "These controls remain unsupported on fresh, resumed and forked sessions. " +
    "Use n-dx work --provider=api with a supported OpenAI model when Hench tool guards are required; " +
    "no provider fallback is applied automatically.";
}
