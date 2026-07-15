import { describe, it, expect } from "vitest";
import { formatCloseError } from "../../../src/agent/lifecycle/cli-loop.js";

/**
 * Windows close-path not-found detection (GH #68).
 *
 * Under spawnCli on win32 a missing vendor CLI never fires ENOENT — cmd.exe
 * spawns fine and exits non-zero with "'X' is not recognized..." on stderr.
 * formatCloseError routes that through diagnoseCliInvocation with the vendor's
 * config key while always preserving the raw stderr detail.
 */
describe("formatCloseError", () => {
  // Absolute + nonexistent → diagnoseCliInvocation takes its deterministic
  // absolute-path branch (existsSync false), no PATH lookup needed.
  const missing = "C:\\tools\\does-not-exist-claude.cmd";

  it("routes 'is not recognized' stderr through diagnosis with the claude config key", () => {
    const err = formatCloseError({
      code: 1,
      stderr:
        `'${missing}' is not recognized as an internal or external command,\r\n` +
        "operable program or batch file.",
      vendor: "claude",
      cliBinary: missing,
    });

    expect(err).toContain("llm.claude.cli_path");
    // Raw stderr detail is never dropped.
    expect(err).toContain("is not recognized");
  });

  it("uses the codex config key for the codex vendor", () => {
    const err = formatCloseError({
      code: 1,
      stderr: `'${missing}' is not recognized as an internal or external command`,
      vendor: "codex",
      cliBinary: missing,
    });

    expect(err).toContain("llm.codex.cli_path");
  });

  it("does not misclassify generic task stderr as CLI-not-found", () => {
    // A legitimate run — the binary EXISTS (process.execPath) — whose subcommand
    // printed a generic Windows error must not be reclassified as a missing CLI.
    const err = formatCloseError({
      code: 1,
      stderr: "The system cannot find the file specified.\n(from a task subcommand)",
      vendor: "claude",
      cliBinary: process.execPath,
    });

    expect(err).not.toContain("llm.claude.cli_path");
    // Original detail preserved as-is.
    expect(err).toContain("cannot find the file specified");
  });

  it("falls back to the exit-code string when stderr is empty", () => {
    const err = formatCloseError({ code: 7, stderr: "", vendor: "codex", cliBinary: missing });
    expect(err).toBe("codex exited with code 7");
  });
});
