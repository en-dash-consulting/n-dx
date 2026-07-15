import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliClient } from "../../src/cli-provider.js";
import { buildWindowsCliCommandLine } from "../../src/exec.js";

const isWindows = process.platform === "win32";

/**
 * Write a fake `claude` CLI into a directory whose name contains a space.
 *
 * On Windows the fixture is a `.cmd` shim — exactly the case that triggered
 * EINVAL under the old `spawn(binary, args)` path (#37) and that the manual
 * `shell: true` workaround still mishandled for spaced paths (#68). On other
 * platforms it is a `#!/bin/sh` script. Either way the binary path contains a
 * space so the spawn recipe must quote it.
 */
function writeSpacedFakeCli(envelope: string): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), "ndx-cli-"));
  const spaced = join(root, "with space");
  mkdirSync(spaced);

  if (isWindows) {
    const path = join(spaced, "claude.cmd");
    // Echo the JSON envelope verbatim. The provider writes+ends stdin; the
    // shim never reads it (handled by the provider's stdin error handler).
    writeFileSync(path, `@echo off\r\necho ${envelope}\r\n`);
    return { root, path };
  }

  const path = join(spaced, "claude");
  writeFileSync(
    path,
    `#!/bin/sh\ncat > /dev/null\nprintf '%s' '${envelope.replace(/'/g, "'\\''")}'\n`,
    { mode: 0o755 },
  );
  chmodSync(path, 0o755);
  return { root, path };
}

describe("CLI spawn routing — spawnCli (GH #37/#68/#69)", () => {
  it("invokes a .cmd fixture at a path containing spaces without throwing EINVAL", async () => {
    const { root, path } = writeSpacedFakeCli(
      '{"result":"ROUTED_OK","input_tokens":1,"output_tokens":1}',
    );
    try {
      const client = createCliClient({ claudeConfig: { cli_path: path }, maxRetries: 0 });
      // A successful completion proves the spaced .cmd path was spawned and
      // parsed — EINVAL / ENOENT would reject before we get here.
      const result = await client.complete({ prompt: "hi", model: "claude-sonnet-4-6" });
      expect(result.text).toBe("ROUTED_OK");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("quotes a binary path containing spaces in the Windows command line", () => {
    const cmdLine = buildWindowsCliCommandLine("C:\\Program Files\\claude.cmd", ["-p", "-"]);
    expect(cmdLine).toBe('"C:\\Program Files\\claude.cmd" "-p" "-"');
  });
});
