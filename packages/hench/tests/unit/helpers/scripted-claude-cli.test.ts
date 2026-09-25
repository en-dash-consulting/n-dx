import { describe, it, expect } from "vitest";
import { buildWindowsCliCommandLine } from "../../../src/prd/llm-gateway.js";
import { decodeWindowsCommandLine } from "../../helpers/scripted-claude-cli.js";

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
