/** Fixed commands and sanitized evidence for the opt-in CLI smoke. */
export const HEADER_CHECK = 'test -z "$NDX_SIDECAR_HEADER_X_NDX_SIDECAR_KEY" && test -z "$NDX_SIDECAR_HEADER_X_NDX_WORKSPACE"';
export const HEADER_COMMAND = `if ${HEADER_CHECK}; then printf '%s\\n' SIDECAR_HEADERS_HIDDEN; else printf '%s\\n' SIDECAR_HEADERS_VISIBLE; fi`;
export const WRITE_PROBE = "sidecar-write-probe";

export function shellCommandEvidence(item: Record<string, unknown>) {
  const command = String(item.command ?? "");
  const output = String(item.aggregated_output ?? item.output ?? "");
  return {
    headerCheckAttempted: command.includes(HEADER_CHECK)
      && !/NDX_SIDECAR_HEADER_\w+=/.test(command),
    headersHidden: output.split(/\r?\n/).includes("SIDECAR_HEADERS_HIDDEN")
      && !output.includes("SIDECAR_HEADERS_VISIBLE"),
    exitCode: typeof item.exit_code === "number" ? item.exit_code : null,
  };
}

/** Map the verified resumed policy to the native CLI's built-in profile. */
export function nativeSandboxArgs(resumedArgs: readonly string[], cwd: string, node: string): string[] {
  if (resumedArgs[0] !== "exec" || resumedArgs[1] !== "resume") {
    throw new Error("Native sandbox probe requires an observed resumed CLI spawn");
  }
  const config = resumedArgs.filter((_arg, i) => resumedArgs[i - 1] === "-c");
  const policy = config.filter((arg) => /^(sandbox_mode|approval_policy)=/.test(arg));
  if (policy.length !== 2 || !policy.includes('sandbox_mode="read-only"') || !policy.includes('approval_policy="never"')) {
    throw new Error("Native sandbox probe requires the resumed read-only/never overrides");
  }
  // Current CLI's `sandbox` requires a permission profile and a direct command.
  // The colon selects the built-in profile; `read-only` would require a custom
  // permissions table. Do not mix profile selection with legacy sandbox_mode.
  // An empty, disposable CODEX_HOME matches exec's
  // --ignore-user-config without passing that exec-only flag to sandbox.
  // No broker, model, credentials, or shell startup files participate here.
  return ["sandbox", "--permission-profile", ":read-only", "-c", 'approval_policy="never"', "-C", cwd, "--", node, "-e", `
    const { writeFileSync } = require("node:fs");
    console.log("SIDECAR_NATIVE_STARTED");
    try {
      writeFileSync(${JSON.stringify(WRITE_PROBE)}, "probe");
      console.log("SIDECAR_NATIVE_WRITE_SUCCEEDED");
    } catch (error) {
      if (["EACCES", "EPERM", "EROFS"].includes(error.code)) {
        console.log("SIDECAR_NATIVE_OS_DENIED");
        process.exit(73);
      }
      console.log("SIDECAR_NATIVE_OTHER_FAILURE");
      process.exit(74);
    }
  `];
}

/** Never expose native stdout/stderr, argv, or errors in the smoke artifact. */
export function nativeSandboxEvidence(result: {
  stdout: string | null;
  status: number | null;
  signal: string | null;
  error?: Error;
}, fileExists: boolean) {
  const lines = (result.stdout ?? "").split(/\r?\n/);
  const commandStarted = lines.includes("SIDECAR_NATIVE_STARTED");
  const writeSucceeded = fileExists || lines.includes("SIDECAR_NATIVE_WRITE_SUCCEEDED");
  const osDenied = commandStarted && !writeSucceeded && !result.error && result.signal === null
    && result.status === 73 && lines.includes("SIDECAR_NATIVE_OS_DENIED")
    && !lines.includes("SIDECAR_NATIVE_OTHER_FAILURE");
  return {
    commandStarted, writeSucceeded, osDenied, exitCode: result.status,
    spawnFailed: !!result.error, terminated: result.signal !== null,
  };
}
