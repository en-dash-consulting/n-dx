import { describe, it, expect, vi } from "vitest";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { buildWindowsCliCommandLine } from "../../../src/prd/llm-gateway.js";
import { decodeWindowsCommandLine } from "../../helpers/scripted-claude-cli.js";
import { cliSpawnsOnly } from "../../helpers/index.js";

/**
 * The scripted CLI decodes the `cmd.exe` command line `spawnCli` builds on
 * Windows back into argv, so the background-wait tests assert the same argv
 * on every platform. A decoder that drifted from the encoder would make those
 * tests fail only on the Windows runner — which is how they first broke — so
 * the round trip is pinned here, where it runs everywhere.
 */
describe("decodeWindowsCommandLine", () => {
  it.each([
    [["-p", "--resume", "sess-work-0001", "--output-format", "stream-json"]],
    [["--allowed-tools", "Read,Edit,Bash(git commit:*),Bash(npm:*)"]],
    [["exec", "resume", "01a05958-2931-73f1", "--json", "-"]],
    [["a \"quoted\" word", "trailing\\", "mid\\dle", "\\\"", ""]],
  ])("round-trips %j through buildWindowsCliCommandLine", (argv) => {
    const line = buildWindowsCliCommandLine("claude", argv);
    expect(decodeWindowsCommandLine(line)).toEqual(["claude", ...argv]);
  });

  it("keeps a quoted binary path with spaces as one token", () => {
    const line = buildWindowsCliCommandLine("C:\\Program Files\\claude\\claude.cmd", ["-p"]);
    expect(decodeWindowsCommandLine(line)).toEqual(["C:\\Program Files\\claude\\claude.cmd", "-p"]);
  });
});

describe("scripted CLI config preflight", () => {
  it.each(["POSIX", "Windows"])("preserves the model-response queue behind %s spawning", async platform => {
    const modelTurn = Symbol("model turn");
    const model = vi.fn(() => modelTurn);
    const spawn = cliSpawnsOnly(model);
    const set = { TMPDIR: "C:\\private temp\\scratch", TMP: "C:\\private temp\\scratch", TEMP: "C:\\private temp\\scratch" };
    const args = ["app-server", ...Object.entries(set).flatMap(([key, value]) => ["-c", `shell_environment_policy.set.${key}=${JSON.stringify(value)}`])];
    const child = (platform === "Windows"
      ? spawn("C:\\Windows\\System32\\cmd.exe", ["/d", "/v:off", "/s", "/c", `"${buildWindowsCliCommandLine("codex", args)}"`])
      : spawn("codex", args)) as ChildProcessWithoutNullStreams;
    try {
      const response = new Promise<string>(resolve => child.stdout.once("data", chunk => resolve(String(chunk))));
      child.stdin.write(JSON.stringify({ id: 1, method: "config/read" }) + "\n");
      expect(JSON.parse(await response)).toEqual({ id: 1, result: { config: { shell_environment_policy: { set } } } });
      expect(model).not.toHaveBeenCalled();
      expect(spawn("codex", ["exec", "-m", "gpt-5.4"])).toBe(modelTurn);
      expect(model).toHaveBeenCalledExactlyOnceWith("codex", ["exec", "-m", "gpt-5.4"], undefined);
    } finally {
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    }
  });
});
