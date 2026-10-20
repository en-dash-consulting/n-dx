/**
 * The pack directory's writer lock (`pack-lock.ts`) and the rename rollback
 * of `sv pack add --from` (`replaceInstalled`).
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { replaceInstalled } from "../../../src/cli/commands/pack.js";
import { acquirePackLock, packLockPath, pidAlive } from "../../../src/cli/commands/pack-lock.js";

let root: string;
let packDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sv-pack-lock-"));
  packDir = join(root, "packs", "1.2.3");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const writeLock = (pid: number, token = "theirs"): void => {
  mkdirSync(join(root, "packs"), { recursive: true });
  writeFileSync(packLockPath(packDir), JSON.stringify({ pid, token, command: "pack add java", since: "2026-10-17T00:00:00.000Z" }));
};
const lockContent = () => JSON.parse(readFileSync(packLockPath(packDir), "utf-8")) as { pid: number; token: string; command: string };

/** The PID of a process that has exited. */
function deadPid(): number {
  const pid = spawnSync(process.execPath, ["-e", ""]).pid;
  expect(pidAlive(pid)).toBe(false);
  return pid;
}

describe("acquirePackLock", () => {
  it("creates <pack dir>.lock with this PID and the command, and release removes it", () => {
    const release = acquirePackLock(packDir, "pack add java");
    expect(lockContent()).toMatchObject({ pid: process.pid, command: "pack add java" });
    release();
    expect(existsSync(packLockPath(packDir))).toBe(false);
    expect(readdirSync(join(root, "packs"))).toEqual([]);
  });

  it("refuses a second writer while the lock is held, naming the holder's PID", () => {
    const release = acquirePackLock(packDir, "pack add java");
    expect(() => acquirePackLock(packDir, "pack remove go")).toThrow(`Another sv pack (PID ${process.pid}, \`pack add java\``);
    release();
    acquirePackLock(packDir, "pack remove go")();
  });

  it("refuses a lock held by a live process other than this one", () => {
    writeLock(process.ppid);
    expect(() => acquirePackLock(packDir, "pack add go")).toThrow(`PID ${process.ppid}`);
    expect(lockContent().pid).toBe(process.ppid);
  });

  it("takes over a lock whose PID is dead", () => {
    writeLock(deadPid());
    const release = acquirePackLock(packDir, "pack add go");
    expect(lockContent()).toMatchObject({ pid: process.pid, command: "pack add go" });
    release();
    expect(readdirSync(join(root, "packs"))).toEqual([]);
  });

  it("fails naming the file to delete when the lock does not read as one", () => {
    mkdirSync(join(root, "packs"), { recursive: true });
    writeFileSync(packLockPath(packDir), "");
    expect(() => acquirePackLock(packDir, "pack add go")).toThrow(/cannot be read as a lock/);
  });

  it("puts back a lock another writer took while this one judged the old one dead, and fails", () => {
    writeLock(4242, "dead");
    let judged = false;
    // While this writer checks the dead PID, another one recovers the lock and takes it.
    const isAlive = (pid: number): boolean => {
      if (pid === 4242 && !judged) {
        judged = true;
        writeLock(process.ppid, "fresh");
      }
      return false;
    };
    expect(() => acquirePackLock(packDir, "pack add go", isAlive)).toThrow(/took the pack directory lock/);
    expect(lockContent()).toMatchObject({ pid: process.ppid, token: "fresh" });
    expect(readdirSync(join(root, "packs"))).toEqual(["1.2.3.lock"]);
  });

  it("release leaves a lock that is no longer its own", () => {
    const release = acquirePackLock(packDir, "pack add java");
    writeLock(process.ppid, "someone else");
    release();
    expect(lockContent().token).toBe("someone else");
  });
});

describe("replaceInstalled", () => {
  const lay = (dir: string, name: string, marker: string): void => {
    mkdirSync(join(dir, "node_modules", name), { recursive: true });
    writeFileSync(join(dir, "node_modules", name, "marker"), marker);
  };
  const marker = (name: string): string => readFileSync(join(packDir, "node_modules", name, "marker"), "utf-8");

  it("moves the named staged packages over the installed ones and keeps the rest", () => {
    const stage = join(root, "stage");
    lay(stage, "a", "staged a");
    lay(packDir, "a", "old a");
    lay(packDir, "other", "other");
    lay(stage, "unnamed", "staged unnamed");
    lay(packDir, "unnamed", "old unnamed");
    replaceInstalled(stage, packDir, ["a"]);
    expect(marker("a")).toBe("staged a");
    expect(marker("other")).toBe("other");
    expect(marker("unnamed")).toBe("old unnamed");
  });

  it("leaves another process's install untouched when a rename fails, and undoes only its own moves", () => {
    const stage = join(root, "stage");
    lay(stage, "a", "staged a");
    lay(stage, "b", "staged b");
    lay(packDir, "a", "old a");
    // Another writer installs b between the existence check and this rename.
    const rename = (from: string, to: string): void => {
      if (to === join(packDir, "node_modules", "b")) {
        lay(packDir, "b", "other process's b");
        throw Object.assign(new Error(`ENOTEMPTY: directory not empty, rename '${from}' -> '${to}'`), { code: "ENOTEMPTY" });
      }
      renameSync(from, to);
    };
    expect(() => replaceInstalled(stage, packDir, ["a", "b"], rename)).toThrow("ENOTEMPTY");
    expect(marker("b")).toBe("other process's b");
    expect(marker("a")).toBe("old a");
  });

  it("puts the displaced copy back when the move of its replacement fails", () => {
    const stage = join(root, "stage");
    lay(stage, "a", "staged a");
    lay(packDir, "a", "old a");
    const rename = (from: string, to: string): void => {
      if (from.startsWith(join(stage, "node_modules"))) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      renameSync(from, to);
    };
    expect(() => replaceInstalled(stage, packDir, ["a"], rename)).toThrow("EACCES");
    expect(marker("a")).toBe("old a");
  });
});
