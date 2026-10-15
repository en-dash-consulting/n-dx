import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliClient } from "../../src/cli-provider.js";
import { buildWindowsCliCommandLine, spawnCli } from "../../src/exec.js";

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

/**
 * cmd.exe expands `%VAR%` inside double quotes, so quoting alone cannot keep a
 * token inert: an expanded value holding a quote ends the argument, and an `&`
 * after it begins a second command. Demonstrated with `model%INJECT%` against
 * `INJECT=x" & mkdir PWNED & echo `, which created the directory.
 *
 * These run on every platform — `_platform` selects the Windows recipe, and the
 * refusal happens before anything is spawned.
 */
describe("spawnCli refuses what cmd.exe would expand", () => {
  const win = { _platform: "win32" as const, stdio: "ignore" as const };

  it("refuses an argument naming a variable the environment defines", () => {
    expect(() =>
      spawnCli("claude", ["--model", "model%INJECT%"], { ...win, env: { INJECT: 'x" & whoami & echo ' } }),
    ).toThrow(/Refusing to spawn.*%INJECT%/s);
  });

  it("refuses the binary too, not just the arguments", () => {
    expect(() =>
      spawnCli("%EVIL%\\claude.cmd", [], { ...win, env: { EVIL: 'x" & whoami & echo ' } }),
    ).toThrow(/Refusing to spawn.*%EVIL%/s);
  });

  it("matches the variable name case-insensitively, as Windows does", () => {
    expect(() =>
      spawnCli("claude", ["%inject%"], { ...win, env: { INJECT: "anything" } }),
    ).toThrow(/Refusing to spawn/);
  });

  /**
   * cmd.exe leaves a name it cannot resolve literal, so such a token was never
   * rewritten and must keep spawning — refusing it would break real directory
   * names over a risk that does not exist. The guard is therefore keyed on the
   * environment, not on the presence of a `%`.
   */
  it.each([
    ["a lone percent sign", "C:\\Users\\100%cool\\claude.cmd"],
    ["a name the environment does not define", "C:\\Users\\50%undefined_var%x\\claude.cmd"],
  ])("still spawns a path with %s", (_label, binary) => {
    let child: ReturnType<typeof spawnCli> | undefined;
    expect(() => {
      child = spawnCli(binary, ["-p"], { ...win, env: { PATH: "" } });
    }).not.toThrow();
    child?.on("error", () => {});
    // The fixture binary does not exist, so the child may already be dead.
    try {
      child?.kill();
    } catch {
      /* never started — nothing to kill */
    }
  });
});
