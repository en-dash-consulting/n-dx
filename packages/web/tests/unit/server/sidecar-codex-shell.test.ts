import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { HEADER_COMMAND, WRITE_PROBE, nativeSandboxArgs, nativeSandboxEvidence, shellCommandEvidence } from "../../helpers/sidecar-codex-shell.js";

describe("live resumed shell evidence", () => {
  it("requires a real check of both variables and successful command output", () => {
    expect(shellCommandEvidence({ command: HEADER_COMMAND, aggregated_output: "SIDECAR_HEADERS_HIDDEN\n", exit_code: 0 }))
      .toEqual({ headerCheckAttempted: true, headersHidden: true, exitCode: 0 });
    expect(shellCommandEvidence({ command: "printf SIDECAR_HEADERS_HIDDEN", output: "SIDECAR_HEADERS_HIDDEN\n" }))
      .toEqual({ headerCheckAttempted: false, headersHidden: true, exitCode: null });
    expect(shellCommandEvidence({ command: `NDX_SIDECAR_HEADER_X_NDX_WORKSPACE='' ${HEADER_COMMAND}` }).headerCheckAttempted).toBe(false);
    expect(shellCommandEvidence({ command: HEADER_COMMAND, output: "SIDECAR_HEADERS_VISIBLE\nSIDECAR_HEADERS_HIDDEN\n" }).headersHidden).toBe(false);
  });

  it("does not serialize raw command output or header values", () => {
    const evidence = shellCommandEvidence({ command: "sensitive-command", output: "sensitive-output", exit_code: 1 });
    expect(JSON.stringify(evidence)).not.toContain("sensitive");
    expect(evidence).toEqual({ headerCheckAttempted: false, headersHidden: false, exitCode: 1 });
  });
});

describe("supplemental native sandbox evidence", () => {
  const resumed = ["exec", "resume", "-c", 'sandbox_mode="read-only"', "-c", 'approval_policy="never"', "--ignore-user-config", "-c", "mcp_servers.ndx-sidecar.url=private-endpoint", "thread-id", "private-prompt"];
  it("maps observed read-only resume policy to the built-in sandbox profile without legacy sandbox config or broker data", () => {
    const args = nativeSandboxArgs(resumed, "/scratch", "/node");
    expect(args.slice(0, -1)).toEqual(["sandbox", "--permission-profile", ":read-only", "-c", 'approval_policy="never"', "-C", "/scratch", "--", "/node", "-e"]);
    expect(JSON.stringify(args)).not.toContain("private");
  });

  it.each([
    ["exec", "--sandbox", "read-only"],
    resumed.filter((arg) => arg !== 'sandbox_mode="read-only"'),
    resumed.filter((arg) => arg !== 'approval_policy="never"'),
    resumed.map((arg) => arg.replace('sandbox_mode="read-only"', 'sandbox_mode="workspace-write"')),
    resumed.map((arg) => arg.replace('approval_policy="never"', 'approval_policy="on-request"')),
    [...resumed, "-c", 'sandbox_mode="danger-full-access"'],
  ])("refuses missing, widened or conflicting observed policy (%#)", (...args) => {
    expect(() => nativeSandboxArgs(args, "/scratch", "/node")).toThrow(/requires/);
  });

  const denied = { stdout: "SIDECAR_NATIVE_STARTED\nSIDECAR_NATIVE_OS_DENIED\n", status: 73, signal: null };
  it("accepts only an executed write denied by the OS", () => {
    expect(nativeSandboxEvidence(denied, false)).toEqual({ commandStarted: true, writeSucceeded: false, osDenied: true, exitCode: 73, spawnFailed: false, terminated: false });
  });

  it.each([
    { stdout: "", status: 2, signal: null }, // CLI setup failure: command never started.
    { ...denied, stdout: "model refusal" },
    { ...denied, stdout: "Permission denied before command started" },
    { ...denied, stdout: "SIDECAR_NATIVE_OS_DENIED\n" },
    { ...denied, stdout: "SIDECAR_NATIVE_STARTED\nSIDECAR_NATIVE_OTHER_FAILURE\n" },
    { ...denied, stdout: denied.stdout + "SIDECAR_NATIVE_WRITE_SUCCEEDED\n" },
    { ...denied, status: 0 },
    { ...denied, status: null },
    { ...denied, signal: "SIGTERM" },
    { ...denied, error: new Error("secret raw subprocess diagnostic") },
  ])("rejects vacuous or contradictory denial evidence (%#)", (result) => {
    const evidence = nativeSandboxEvidence(result, false);
    expect(evidence.osDenied).toBe(false);
    expect(JSON.stringify(evidence)).not.toContain("secret");
  });

  it("fails any successful write even alongside a denial", () => {
    expect(nativeSandboxEvidence(denied, true)).toMatchObject({ writeSucceeded: true, osDenied: false });
  });

  it.each(["EACCES", "EPERM", "EROFS", "ENOENT", undefined])("native command distinguishes OS denial from other errors and success (%s)", (code) => {
    const lines: string[] = [];
    let attempted = false;
    let status = 0;
    const exited = new Error("probe exited");
    const run = () => runInNewContext(nativeSandboxArgs(resumed, "/scratch", "/node").at(-1)!, {
      require: (name: string) => {
        expect(name).toBe("node:fs");
        return { writeFileSync: (path: string, value: string) => {
          expect(path).toBe(WRITE_PROBE);
          expect(value).toBe("probe");
          attempted = true;
          if (code) throw Object.assign(new Error("private diagnostic"), { code });
        } };
      },
      console: { log: (line: string) => lines.push(line) },
      process: { exit: (value: number) => { status = value; throw exited; } },
    });
    if (code) expect(run).toThrow(exited); else run();
    expect(attempted).toBe(true);
    const evidence = nativeSandboxEvidence({ stdout: lines.join("\n"), status, signal: null }, !code);
    expect(evidence.osDenied).toBe(code !== undefined && code !== "ENOENT");
    expect(evidence.writeSucceeded).toBe(code === undefined);
    expect(lines.join("\n")).not.toContain("private diagnostic");
  });
});
