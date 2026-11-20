import { createHash } from "node:crypto";
import { codexSessionDriver, type ExecutionPolicy } from "../../prd/llm-gateway.js";
import { captureRunGitOrigin } from "../../process/git-origin.js";
import { policyFingerprint } from "./session-cache.js";

export interface CodexReuseInput {
  binary: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  model: string;
  permissionMode: string;
  policy: ExecutionPolicy;
}

/** Ephemeral admission stamp, never persisted or printed with credentials. */
export function codexReuseIdentity(input: CodexReuseInput): string | undefined {
  const capability = codexSessionDriver.probeResume?.(input.binary, input.env, input.cwd);
  if (!capability?.supported || !capability.reusable || !capability.identity) return undefined;
  const origin = captureRunGitOrigin(input.cwd);
  if (!origin.worktreeRoot || (!origin.branch && !origin.startHead)) return undefined;
  return createHash("sha256").update(JSON.stringify([
    origin.worktreeRoot, origin.branch ?? origin.startHead,
    input.binary, capability.version, capability.identity,
    Object.entries(input.env).sort(([a], [b]) => a.localeCompare(b)),
    input.model, input.permissionMode, policyFingerprint(input.policy),
  ])).digest("hex");
}

export function sameCodexSessionIdentity(before: string | undefined, after: string | undefined): boolean {
  return before !== undefined && before === after;
}
