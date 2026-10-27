/**
 * Windows console-window policy: every child process n-dx starts passes
 * `windowsHide`.
 *
 * On Windows, libuv maps `detached: true` to DETACHED_PROCESS and
 * `windowsHide: true` to CREATE_NO_WINDOW. A detached parent (the hub, the
 * background dashboard, `sv narrate`) and a hidden child (anything the
 * dashboard spawns through `spawnManaged`) therefore have no console — and
 * every console-subsystem child they start WITHOUT `windowsHide` is handed
 * a brand-new, visible console window. The window lives as long as the
 * child: a flash for a `git rev-parse`, minutes for a test suite, and for
 * an abandoned narration's vendor CLI, until someone closes it by hand.
 *
 * The flag has to travel with every spawn, because the console is lost at
 * the first unhidden hop. So this gate scans every production spawn in the
 * monorepo (`scripts/lib/windows-hide-scan.mjs`, also runnable on its own)
 * and fails on one whose options object does not mention `windowsHide`. A
 * spawn that must inherit a real terminal (an interactive `ndx work` in the
 * operator's own console) passes `windowsHide: !process.stdout.isTTY` —
 * hidden exactly when ndx itself has no terminal — and so still mentions the
 * key. A site with a reason to be exempt carries the marker comment
 * `windows-console: inherit` on the call or the line above it; the reason
 * belongs beside the marker.
 *
 * Options built elsewhere and spread in (`...spawnOptions`) are the one
 * shape the textual scan cannot see; those helpers are listed in
 * `INDIRECT_OPTION_SOURCES` and are themselves required to set the flag.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { ROOT, INDIRECT_OPTION_SOURCES, findUnhiddenSpawns } from "../../scripts/lib/windows-hide-scan.mjs";

describe("Windows console windows — every production spawn passes windowsHide", () => {
  it("flags no spawn, spawnSync, execFile or execFileSync without windowsHide or an inherit marker", () => {
    expect(
      findUnhiddenSpawns(),
      "Each listed call starts a child that gets its own visible console window when ndx runs without one (hub, background dashboard, narrate, or anything they spawn). Pass `windowsHide: true` for piped/ignored stdio, `windowsHide: !process.stdout.isTTY` for a child that must inherit the operator's terminal, or mark the call `// windows-console: inherit <reason>`.",
    ).toEqual([]);
  });

  it("the indirect option builders it cannot see set the flag themselves", () => {
    for (const rel of INDIRECT_OPTION_SOURCES) {
      const source = readFileSync(join(ROOT, rel), "utf-8");
      expect(source, `${rel} must set windowsHide on the spawn it builds options for`).toMatch(/windowsHide/);
    }
  });
});
