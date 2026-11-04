/**
 * A failing fs.watch must not take the run down. The watcher is only a fast
 * path beside the existsSync poll, so a watch that throws when it starts, or
 * emits 'error' later (EMFILE when the process runs out of descriptors), has
 * to fall back to polling. Before the fix the async 'error' event had no
 * listener, so Node rethrew it and `ndx work` died before the agent started.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RM_RETRY } from "../../../helpers/index.js";

const watchMode = vi.hoisted(() => ({ mode: "emit-error" as "emit-error" | "throw" }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    watch: () => {
      if (watchMode.mode === "throw") {
        throw Object.assign(new Error("EMFILE: too many open files, watch"), { code: "EMFILE" });
      }
      const fake = new EventEmitter() as EventEmitter & { close(): void; unref(): void };
      fake.close = () => {};
      fake.unref = () => {};
      setTimeout(() => {
        fake.emit("error", Object.assign(new Error("EMFILE: too many open files, watch"), { code: "EMFILE" }));
      }, 10);
      return fake;
    },
  };
});

async function waitFor(condition: () => boolean, deadlineMs = 5000): Promise<void> {
  const start = Date.now();
  while (!condition() && Date.now() - start < deadlineMs) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("startCommitMsgWatcher — fs.watch failure", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-watch-fail-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true, ...RM_RETRY });
  });

  for (const mode of ["emit-error", "throw"] as const) {
    it(`${mode}: does not crash and still detects the file by polling`, async () => {
      watchMode.mode = mode;
      const { startCommitMsgWatcher } = await import(
        "../../../../src/agent/lifecycle/commit-msg-watcher.js"
      );

      const watcher = startCommitMsgWatcher({ projectDir, timeoutMs: 50 });
      // Let the fake watcher's 'error' fire before the file appears.
      await new Promise((resolve) => setTimeout(resolve, 30));

      // An empty file takes the no-git branch: detected by the poll, then removed.
      const msgPath = join(projectDir, ".hench-commit-msg.txt");
      await writeFile(msgPath, "", "utf-8");
      await waitFor(() => !existsSync(msgPath));

      expect(existsSync(msgPath)).toBe(false);
      expect(watcher.didAutoCommit()).toBe(false);
      watcher.cancel();
    });
  }
});
