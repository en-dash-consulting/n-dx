/**
 * `ndx config credentials.<name> --helper "<cmd>"`: the command is split with
 * shell-style quoting and no expansion, and anything that only a shell would
 * act on is refused. No shell ever runs the helper.
 */
import { describe, it, expect } from "vitest";
import { parseHelperCommand } from "../../packages/core/config.js";

describe("parseHelperCommand", () => {
  it.each([
    ["op read op://vault/item/field", ["op", "read", "op://vault/item/field"]],
    ['op read "op://Private Vault/item/field"', ["op", "read", "op://Private Vault/item/field"]],
    ["pass show 'ndx/type safe'", ["pass", "show", "ndx/type safe"]],
    ["  gopass   show  -o  ndx/key  ", ["gopass", "show", "-o", "ndx/key"]],
    ['bw get password "say \\"hi\\""', ["bw", "get", "password", 'say "hi"']],
    ["a\\ b c", ["a b", "c"]],
    ['"/Applications/My Tools/op" read x', ["/Applications/My Tools/op", "read", "x"]],
    ["'C:\\Program Files\\op.exe' read x", ["C:\\Program Files\\op.exe", "read", "x"]],
    ["pass show ''", ["pass", "show", ""]],
  ])("splits %j", (text, argv) => {
    expect(parseHelperCommand(text)).toEqual({ argv });
  });

  it("expands nothing: variables, home and globs stay literal", () => {
    expect(parseHelperCommand("pass show $HOME/~/*")).toEqual({ argv: ["pass", "show", "$HOME/~/*"] });
    expect(parseHelperCommand("pass show ${HOME}")).toEqual({ argv: ["pass", "show", "${HOME}"] });
  });

  it.each([
    ["op read x | cat", /"\|"/],
    ["op read x; rm y", /";"/],
    ["op read x && y", /"&"/],
    ["op read x > out", /">"/],
    ["op read < in", /"<"/],
    ["op read $(whoami)", /"\$\("/],
    ["op read `whoami`", /"`"/],
    ["op read 'x | y'", /"\|"/],
    ["-c op", /start with "-"/],
    ["'-c' op", /start with "-"/],
    ['op read "x', /unterminated " quote/],
    ["   ", /empty/],
    ["''", /empty/],
    ["op read x\nrm y", /line break/],
  ])("refuses %j", (text, message) => {
    const result = parseHelperCommand(text);
    expect(result).toHaveProperty("error");
    expect(result.error).toMatch(message);
  });
});
